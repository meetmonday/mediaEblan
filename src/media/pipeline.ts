import { createHash } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import type { FormattableString, InlineKeyboard } from "gramio";
import { config } from "../config.ts";
import { ProviderError } from "../providers/errors.ts";
import { HttpError } from "../providers/http.ts";
import { resolveProvider, supportedSitesText } from "../providers/registry.ts";
import type {
	MediaItem,
	MediaKind,
	Provider,
	ProviderResult,
} from "../providers/types.ts";
import { verrou } from "../services/locks.ts";
import { sourceButtons } from "../shared/keyboards/index.ts";
import { mediaCache } from "./cache.ts";
import { appendSourceLink, cachedCaption, captionFor } from "./caption.ts";
import { CompressionError, compressVideo, fileSize } from "./ffmpeg.ts";

/**
 * Minimal target for whatever delivers media to the user.
 * Handlers adapt a GramIO context; tests use a fake sender.
 */
export interface MediaSender {
	chatAction(action: "upload_photo" | "upload_video"): Promise<unknown>;
	/** `input` is either a local path or an already-known file_id. */
	sendPhoto(
		input: string,
		caption?: FormattableString,
		keyboard?: InlineKeyboard,
	): Promise<{ fileId: string }>;
	/** `input` is either a local path or an already-known file_id. */
	sendVideo(
		input: string,
		caption?: FormattableString,
		keyboard?: InlineKeyboard,
	): Promise<{ fileId: string }>;
	/**
	 * Sends several items as a single album. Caption lands on the first item.
	 * Albums can't carry inline keyboards — with `keyboard` the sender must
	 * deliver the buttons in a separate message.
	 */
	sendMediaGroup(
		inputs: MediaGroupInput[],
		caption?: FormattableString,
		keyboard?: InlineKeyboard,
	): Promise<unknown>;
	/** Sends a text-only result (a comment without media). */
	sendText(
		text: FormattableString,
		opts?: { disableLinkPreview?: boolean },
		keyboard?: InlineKeyboard,
	): Promise<unknown>;
}

export interface MediaGroupInput {
	kind: MediaKind;
	/** Local path or an already-known file_id. */
	input: string;
}

export class MediaError extends Error {
	constructor(
		readonly kind: "unsupported" | "no-media" | "download" | "compress",
		message: string,
	) {
		super(message);
		this.name = "MediaError";
	}
}

const maxBytes = () => config.MAX_FILE_SIZE_MB * 1024 * 1024;

function lockKeyFor(url: URL): string {
	const key = createHash("sha1").update(url.toString()).digest("hex");
	return `media:${key}`;
}

async function cleanup(items: MediaItem[]): Promise<void> {
	const targets = new Set<string>();
	for (const item of items) {
		targets.add(item.path);
		targets.add(`${item.path}.compressed.mp4`);
	}
	await Promise.all(
		[...targets].map((path) => rm(path, { force: true }).catch(() => {})),
	);
}

/**
 * Rethrows any known error from the hierarchy as-is (its message surfaces to
 * the user); wraps unexpected values — non-`Error` or errors from outside the
 * hierarchy — into a download `MediaError`.
 */
function toDownloadError(error: unknown): MediaError {
	if (
		error instanceof HttpError ||
		error instanceof ProviderError ||
		error instanceof MediaError ||
		error instanceof CompressionError
	) {
		throw error;
	}
	return new MediaError(
		"download",
		error instanceof Error ? error.message : "Не удалось скачать медиа",
	);
}

/**
 * Fetches from the provider with a single retry for transient network
 * failures (`HttpError`, which covers `NetworkError`). Semantic provider
 * errors (`ProviderError`) surface immediately, without retry.
 */
async function fetchProviderResult(
	provider: Provider,
	url: URL,
	downloadDir: string,
): Promise<ProviderResult> {
	const attempt = (): Promise<ProviderResult> =>
		provider.fetch(url, downloadDir);
	try {
		return await attempt();
	} catch (error) {
		if (error instanceof HttpError) {
			await Bun.sleep(1_000);
			try {
				return await attempt();
			} catch (retryError) {
				throw toDownloadError(retryError);
			}
		}
		throw toDownloadError(error);
	}
}

/**
 * Options for delivering media from a source URL.
 */
export interface ProcessMediaOptions {
	/**
	 * Pin «Открыть»/«Поделиться» buttons under the message and drop the
	 * `🔗 url` line from the caption. Used by the deep-link flow and inline
	 * results, where the source link is exposed via buttons instead of text.
	 */
	withSourceButtons?: boolean;
}

/**
 * Downloads media from a supported URL and sends it through `sender`.
 * The first item carries a caption built from the source metadata.
 * Cached URLs send the stored file_id directly, without re-downloading.
 * With `withSourceButtons`, the caption's source link is replaced by two
 * buttons under the message («Открыть», «Поделиться»).
 */
export async function processMedia(
	url: URL,
	sender: MediaSender,
	options: ProcessMediaOptions = {},
): Promise<void> {
	const sourceUrl = url.toString();
	const withButtons = options.withSourceButtons ?? false;

	await verrou.createLock(lockKeyFor(url), "5 minutes").run(async () => {
		const cached = mediaCache.get(sourceUrl);
		if (cached) {
			await sender.sendPhoto(
				cached.fileId,
				cachedCaption(cached, undefined, !withButtons),
				withButtons ? sourceButtons(sourceUrl) : undefined,
			);
			return;
		}

		const provider = resolveProvider(url);
		if (!provider) {
			throw new MediaError(
				"unsupported",
				`Поддерживаются ссылки:\n${supportedSitesText()}`,
			);
		}

		await mkdir(config.DOWNLOAD_DIR, { recursive: true });

		const result = await fetchProviderResult(
			provider,
			url,
			config.DOWNLOAD_DIR,
		);
		const keyboard = withButtons ? sourceButtons(sourceUrl) : undefined;

		if (result.items.length === 0) {
			if (result.text) {
				const content =
					result.text.sourceUrl && !withButtons
						? appendSourceLink(result.text.content, result.text.sourceUrl)
						: result.text.content;
				await sender.sendText(
					content,
					{ disableLinkPreview: result.text.disableLinkPreview },
					keyboard,
				);
				return;
			}
			throw new MediaError("no-media", "В ссылке не найдено медиа");
		}

		const caption = captionFor(
			result.metadata,
			result.caption,
			undefined,
			!withButtons,
		).build();
		try {
			const prepare = async (item: MediaItem): Promise<MediaGroupInput> => {
				await sender.chatAction(
					item.kind === "photo" ? "upload_photo" : "upload_video",
				);

				let input = item.path;
				if (item.kind === "video" && (await fileSize(item.path)) > maxBytes()) {
					try {
						input = await compressVideo(
							item.path,
							`${item.path}.compressed.mp4`,
							maxBytes(),
						);
					} catch (error) {
						throw new MediaError(
							"compress",
							error instanceof Error ? error.message : "Не удалось сжать видео",
						);
					}
				}

				return { kind: item.kind, input };
			};

			const first = result.items[0];
			if (first && result.items.length === 1) {
				const { kind, input } = await prepare(first);
				const { fileId } =
					kind === "photo"
						? await sender.sendPhoto(input, caption, keyboard)
						: await sender.sendVideo(input, caption, keyboard);
				mediaCache.set(sourceUrl, {
					kind,
					fileId,
					metadata: result.metadata,
					caption: result.caption,
				});
			} else {
				const inputs: MediaGroupInput[] = [];
				for (const item of result.items) inputs.push(await prepare(item));
				await sender.sendMediaGroup(inputs, caption, keyboard);
			}
		} finally {
			await cleanup(result.items);
		}
	});
}
