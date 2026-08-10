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
}

type Upload = Awaited<ReturnType<typeof MediaUpload.path>> | string;

async function toUpload(input: string): Promise<Upload> {
	return input.includes("/") ? MediaUpload.path(input) : input;
}

/** Builds a `MediaSender` that delivers media through a message context. */
export function senderFrom(context: ReplyMediaContext): MediaSender {
	return {
		chatAction: (action) => context.sendChatAction(action),
		sendPhoto: async (input, caption) => {
			const message = await context.replyWithPhoto(
				await toUpload(input),
				caption ? { caption } : undefined,
			);
			return { fileId: message.photo?.at(-1)?.fileId ?? "" };
		},
		sendVideo: async (input, caption) => {
			const message = await context.replyWithVideo(
				await toUpload(input),
				caption ? { caption } : undefined,
			);
			return { fileId: message.video?.fileId ?? "" };
		},
		sendMediaGroup: async (inputs: MediaGroupInput[], caption) => {
			await context.replyWithMediaGroup(
				await Promise.all(
					inputs.map(async ({ kind, input }, index) => {
						const file = await toUpload(input);
						const options = index === 0 && caption ? { caption } : undefined;
						return kind === "photo"
							? MediaInput.photo(file, options)
							: MediaInput.video(file, options);
					}),
				),
			);
		},
	};
}

/** Downloads media from `url` and sends it via `context`, with error reply. */
export async function sendMedia(
	context: ReplyMediaContext,
	url: URL,
): Promise<void> {
	try {
		await processMedia(url, senderFrom(context));
	} catch (error) {
		const message =
			error instanceof MediaError
				? error.message
				: "Не удалось обработать ссылку";
		await context.reply(`❌ ${message}`).catch(() => {});
	}
}
