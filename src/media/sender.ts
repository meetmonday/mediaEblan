import { MediaInput, MediaUpload } from "gramio";
import type { MediaGroupInput, MediaSender } from "./pipeline.ts";
import { MediaError, processMedia } from "./pipeline.ts";

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
	reply(text: string, params?: object): Promise<unknown>;
	sendPhoto(
		photo: string | File,
		params?: object,
	): Promise<{ photo?: { fileId?: string }[] }>;
	sendVideo(
		video: string | File,
		params?: object,
	): Promise<{ video?: { fileId?: string } }>;
	sendMediaGroup(media: readonly unknown[], params?: object): Promise<unknown>;
	send(text: string, params?: object): Promise<unknown>;
}

type Upload = Awaited<ReturnType<typeof MediaUpload.path>> | string;

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
		sendPhoto: async (input, caption) => {
			const upload = await toUpload(input);
			const params = caption ? { caption } : undefined;
			const message = reply
				? await context.replyWithPhoto(upload, params)
				: await context.sendPhoto(upload, params);
			return { fileId: message.photo?.at(-1)?.fileId ?? "" };
		},
		sendVideo: async (input, caption) => {
			const upload = await toUpload(input);
			const params = caption ? { caption } : undefined;
			const message = reply
				? await context.replyWithVideo(upload, params)
				: await context.sendVideo(upload, params);
			return { fileId: message.video?.fileId ?? "" };
		},
		sendMediaGroup: async (inputs: MediaGroupInput[], caption) => {
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
		},
	};
}

/**
 * Downloads media from `url` and sends it via `context`, with error reply.
 * `includeSourceLink` adds a `🔗 <url>` caption line (like inline sending).
 * `reply = false` sends media as regular messages, not replies.
 */
export async function sendMedia(
	context: ReplyMediaContext,
	url: URL,
	options: { includeSourceLink?: boolean; reply?: boolean } = {},
): Promise<void> {
	try {
		await processMedia(
			url,
			senderFrom(context, options.reply ?? true),
			options.includeSourceLink,
		);
	} catch (error) {
		const text = `❌ ${
			error instanceof MediaError
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
