import { Composer, MediaInput, MediaUpload } from "gramio";
import type { MediaGroupInput, MediaSender } from "../media/pipeline.ts";
import { MediaError, processMedia } from "../media/pipeline.ts";
import { composer } from "../plugins/index.ts";
import { findMediaUrl } from "../providers/registry.ts";

type Upload = Awaited<ReturnType<typeof MediaUpload.path>> | string;

async function toUpload(input: string): Promise<Upload> {
	return input.includes("/") ? MediaUpload.path(input) : input;
}

export const mediaComposer = new Composer()
	.extend(composer)
	.hears(/https?:\/\/\S+/i, async (context) => {
		const url = findMediaUrl(context.text ?? "");
		if (!url) return;

		const sender: MediaSender = {
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

		try {
			await processMedia(url, sender);
		} catch (error) {
			const message =
				error instanceof MediaError
					? error.message
					: "Не удалось обработать ссылку";
			await context.reply(`❌ ${message}`).catch(() => {});
		}
	});
