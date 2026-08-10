import { createHash } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { config } from "../config.ts";
import { HttpError } from "../providers/http.ts";
import { listSupportedSites, resolveProvider } from "../providers/registry.ts";
import type {
	MediaItem,
	MediaKind,
	Provider,
	ProviderResult,
} from "../providers/types.ts";
import { verrou } from "../services/locks.ts";
import { mediaCache } from "./cache.ts";
import { buildCaption } from "./caption.ts";
import { compressVideo, fileSize } from "./ffmpeg.ts";

/**
 * Minimal target for whatever delivers media to the user.
 * Handlers adapt a GramIO context; tests use a fake sender.
 */
export interface MediaSender {
	chatAction(action: "upload_photo" | "upload_video"): Promise<unknown>;
	/** `input` is either a local path or an already-known file_id. */
	sendPhoto(input: string, caption?: string): Promise<{ fileId: string }>;
	/** `input` is either a local path or an already-known file_id. */
	sendVideo(input: string, caption?: string): Promise<{ fileId: string }>;
	/** Sends several items as a single album. Caption lands on the first item. */
	sendMediaGroup(inputs: MediaGroupInput[], caption?: string): Promise<unknown>;
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

function toDownloadError(error: unknown): MediaError {
	return new MediaError(
		"download",
		error instanceof Error ? error.message : "Не удалось скачать медиа",
	);
}

/**
 * Fetches from the provider with a single retry for transient network
 * failures (`HttpError`). Semantic provider errors surface immediately.
 */
async function fetchProviderResult(
	provider: Provider,
	url: URL,
	downloadDir: string,
): Promise<ProviderResult> {
	try {
		return await provider.fetch(url, downloadDir);
	} catch (error) {
		if (!(error instanceof HttpError)) throw toDownloadError(error);
		await Bun.sleep(1_000);
		try {
			return await provider.fetch(url, downloadDir);
		} catch (error2) {
			throw toDownloadError(error2);
		}
	}
}

/**
 * Downloads media from a supported URL and sends it through `sender`.
 * The first item carries a caption built from the source metadata.
 * Cached URLs send the stored file_id directly, without re-downloading.
 * With `includeSourceLink`, the caption gets a `🔗 <url>` line (like inline).
 */
export async function processMedia(
	url: URL,
	sender: MediaSender,
	includeSourceLink = false,
): Promise<void> {
	const sourceUrl = url.toString();

	await verrou.createLock(lockKeyFor(url), "5 minutes").run(async () => {
		const cached = mediaCache.get(sourceUrl);
		if (cached) {
			await sender.sendPhoto(
				cached.fileId,
				buildCaption(
					cached.metadata,
					includeSourceLink ? sourceUrl : undefined,
				),
			);
			return;
		}

		const provider = resolveProvider(url);
		if (!provider) {
			throw new MediaError(
				"unsupported",
				`Поддерживаются ссылки: ${listSupportedSites().join(", ")}`,
			);
		}

		await mkdir(config.DOWNLOAD_DIR, { recursive: true });

		const result = await fetchProviderResult(
			provider,
			url,
			config.DOWNLOAD_DIR,
		);
		if (result.items.length === 0)
			throw new MediaError("no-media", "В ссылке не найдено медиа");

		const caption = buildCaption(
			result.metadata,
			includeSourceLink ? sourceUrl : undefined,
		);
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
						? await sender.sendPhoto(input, caption)
						: await sender.sendVideo(input, caption);
				mediaCache.set(sourceUrl, { kind, fileId, metadata: result.metadata });
			} else {
				const inputs: MediaGroupInput[] = [];
				for (const item of result.items) inputs.push(await prepare(item));
				await sender.sendMediaGroup(inputs, caption);
			}
		} finally {
			await cleanup(result.items);
		}
	});
}
