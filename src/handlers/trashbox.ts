import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { Composer, MediaInput, MediaUpload } from "gramio";
import { config } from "../config.ts";
import { composer } from "../plugins/index.ts";
import { downloadTo, HttpError } from "../providers/http.ts";
import {
	buildCommentMessage,
	commentMediaSources,
	fetchComment,
	findCommentUrl,
	firstImgSrc,
	resolveCommentUrl,
	TrashboxError,
} from "../services/trashbox.ts";

type Upload = Awaited<ReturnType<typeof MediaUpload.path>> | string;

async function toUpload(input: string): Promise<Upload> {
	return input.includes("/") ? MediaUpload.path(input) : input;
}

function extensionOf(url: string): string {
	const pathname = new URL(url).pathname;
	const ext = pathname.split(".").at(-1)?.toLowerCase();
	return ext && /^[a-z0-9]+$/.test(ext) ? `.${ext}` : ".jpg";
}

export const trashboxComposer = new Composer()
	.extend(composer)
	.hears(/https?:\/\/\S+#div_comment_/i, async (context) => {
		const url = findCommentUrl(context.text ?? "");
		if (!url) return;

		try {
			const { topicId, commentId, host } = await resolveCommentUrl(url);
			const comment = await fetchComment(topicId, commentId, host);
			if (!comment) {
				await context.reply("❌ Комментарий не найден").catch(() => {});
				return;
			}

			const mediaUrls = commentMediaSources(comment.content);
			if (mediaUrls.length === 0) {
				await context.send(buildCommentMessage(comment, url.toString()), {
					link_preview_options: {
						is_disabled: firstImgSrc(comment.content) === null,
					},
				});
				return;
			}

			// Comment embeds images — download them and send as media, the
			// comment text becomes the caption.
			const caption = buildCommentMessage(comment, url.toString(), false);
			const paths: string[] = [];
			try {
				await context.sendChatAction("upload_photo");
				await mkdir(config.DOWNLOAD_DIR, { recursive: true });
				for (const [index, mediaUrl] of mediaUrls.entries()) {
					const outPath = join(
						config.DOWNLOAD_DIR,
						`trashbox-${commentId}-${index}${extensionOf(mediaUrl)}`,
					);
					await downloadTo(mediaUrl, outPath);
					paths.push(outPath);
				}

				if (paths.length === 1) {
					await context.replyWithPhoto(await toUpload(paths[0] ?? ""), {
						caption,
					});
				} else {
					await context.replyWithMediaGroup(
						await Promise.all(
							paths.map(async (path, index) =>
								MediaInput.photo(
									await toUpload(path),
									index === 0 ? { caption } : undefined,
								),
							),
						),
					);
				}
			} finally {
				await Promise.all(
					paths.map((path) => rm(path, { force: true }).catch(() => {})),
				);
			}
		} catch (error) {
			const message =
				error instanceof TrashboxError || error instanceof HttpError
					? error.message
					: "Не удалось получить комментарий";
			await context.reply(`❌ ${message}`).catch(() => {});
		}
	});
