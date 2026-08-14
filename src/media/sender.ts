import type { FormattableString, InlineKeyboard } from "gramio";
import { MediaInput, MediaUpload } from "gramio";
import { ProviderError } from "../providers/errors.ts";
import { HttpError } from "../providers/http.ts";
import type { MediaGroupInput, MediaSender } from "./pipeline.ts";
import { MediaError, processMedia } from "./pipeline.ts";

type TextLike = string | FormattableString;

/**
 * Invisible filler so a buttons-only message has non-empty text.
 * Telegram rejects truly empty text on `sendMessage`.
 */
const EMPTY_TEXT = "\u200b";

/**
 * The slice of a GramIO message context needed to deliver media.
 * Both the chat handler and the `/start` deep-link handler satisfy it.
 */
export interface ReplyMediaContext {
	sendChatAction(action: "upload_photo" | "upload_video"): Promise<unknown>;
	replyWithPhoto(
		photo: string | File,
		params?: object,
	): Promise<{ photo?: { fileId?: string }[] }>;
	replyWithVideo(
		video: string | File,
		params?: object,
	): Promise<{ video?: { fileId?: string } }>;
	replyWithMediaGroup(
		media: readonly unknown[],
		params?: object,
	): Promise<unknown>;
	reply(text: TextLike, params?: object): Promise<unknown>;
	sendPhoto(
		photo: string | File,
		params?: object,
	): Promise<{ photo?: { fileId?: string }[] }>;
	sendVideo(
		video: string | File,
		params?: object,
	): Promise<{ video?: { fileId?: string } }>;
	sendMediaGroup(media: readonly unknown[], params?: object): Promise<unknown>;
	send(text: TextLike, params?: object): Promise<unknown>;
}

type Upload = Awaited<ReturnType<typeof MediaUpload.path>> | string;

/**
 * Converts a media input to a GramIO upload.
 * Contract: a string containing a path separator (`/`) is a local file path
 * (as produced by `downloadMediaSources`); anything else is a cached
 * Telegram `file_id` passed through unchanged.
 */
async function toUpload(input: string): Promise<Upload> {
	return input.includes("/") ? MediaUpload.path(input) : input;
}

/**
 * Builds a `MediaSender` that delivers media through a message context.
 * With `reply = false` the media is sent as a regular message instead of a
 * reply (used by the deep-link flow whose `/start` message gets deleted).
 */
export function senderFrom(
	context: ReplyMediaContext,
	reply = true,
): MediaSender {
	return {
		chatAction: (action) => context.sendChatAction(action),
		sendPhoto: async (input, caption, keyboard) => {
			const upload = await toUpload(input);
			const params = paramsFor({ caption, keyboard });
			const message = reply
				? await context.replyWithPhoto(upload, params)
				: await context.sendPhoto(upload, params);
			return { fileId: message.photo?.at(-1)?.fileId ?? "" };
		},
		sendVideo: async (input, caption, keyboard) => {
			const upload = await toUpload(input);
			const params = paramsFor({ caption, keyboard });
			const message = reply
				? await context.replyWithVideo(upload, params)
				: await context.sendVideo(upload, params);
			return { fileId: message.video?.fileId ?? "" };
		},
		sendMediaGroup: async (inputs: MediaGroupInput[], caption, keyboard) => {
			const media = await Promise.all(
				inputs.map(async ({ kind, input }, index) => {
					const file = await toUpload(input);
					const options = index === 0 && caption ? { caption } : undefined;
					return kind === "photo"
						? MediaInput.photo(file, options)
						: MediaInput.video(file, options);
				}),
			);
			if (reply) await context.replyWithMediaGroup(media);
			else await context.sendMediaGroup(media);
			// Albums can't carry inline keyboards — deliver the buttons separately.
			if (keyboard) {
				if (reply) await context.reply(EMPTY_TEXT, { reply_markup: keyboard });
				else await context.send(EMPTY_TEXT, { reply_markup: keyboard });
			}
		},
		sendText: async (text, opts, keyboard) => {
			const params: Record<string, unknown> = {};
			if (opts?.disableLinkPreview)
				params.link_preview_options = { is_disabled: true };
			if (keyboard) params.reply_markup = keyboard;
			if (reply) await context.reply(text, params);
			else await context.send(text, params);
		},
	};
}

function paramsFor(values: {
	caption?: FormattableString;
	keyboard?: InlineKeyboard;
}): Record<string, unknown> {
	const params: Record<string, unknown> = {};
	if (values.caption) params.caption = values.caption;
	if (values.keyboard) params.reply_markup = values.keyboard;
	return params;
}

/**
 * Downloads media from `url` and sends it via `context`, with error reply.
 * `withSourceButtons` pins «Открыть»/«Поделиться» buttons under the media
 * instead of the source link caption line (used by the deep-link flow).
 * `reply = false` sends media as regular messages, not replies.
 */
export async function sendMedia(
	context: ReplyMediaContext,
	url: URL,
	options: { withSourceButtons?: boolean; reply?: boolean } = {},
): Promise<void> {
	try {
		await processMedia(url, senderFrom(context, options.reply ?? true), {
			withSourceButtons: options.withSourceButtons,
		});
	} catch (error) {
		const text = `❌ ${
			error instanceof MediaError ||
			error instanceof ProviderError ||
			error instanceof HttpError
				? error.message
				: "Не удалось обработать ссылку"
		}`;
		const send = async () => {
			if (options.reply === false) await context.send(text);
			else await context.reply(text);
		};
		await send().catch(() => {});
	}
}
