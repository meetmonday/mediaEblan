import type { TelegramInlineQueryResult } from "@gramio/types";
import { Composer, InlineQueryResult, InputMessageContent } from "gramio";
import { mediaCache } from "../media/cache.ts";
import { buildCaption } from "../media/caption.ts";
import { composer } from "../plugins/index.ts";
import { findMediaUrl, resolveProvider } from "../providers/registry.ts";
import type { DirectMediaResult } from "../providers/types.ts";
import type { TrashboxComment } from "../services/trashbox.ts";
import {
	buildCommentMessage,
	fetchComment,
	findCommentUrl,
	resolveCommentUrl,
} from "../services/trashbox.ts";

const ANSWER_OPTIONS = { cache_time: 0, is_personal: true } as const;

const OPEN_BOT_BUTTON = {
	text: "Открыть бот и вставить ссылку",
	start_parameter: "inline",
};

function toInlineResults(
	{ metadata, items }: DirectMediaResult,
	sourceUrl: string,
): TelegramInlineQueryResult[] {
	const caption = buildCaption(metadata, sourceUrl);
	const results: TelegramInlineQueryResult[] = [];
	for (const [index, item] of items.entries()) {
		if (item.kind === "photo") {
			results.push(
				InlineQueryResult.photo(
					String(index),
					item.url,
					item.thumbnailUrl ?? item.url,
					{
						caption,
						title: `Фото ${index + 1}`,
					},
				),
			);
		} else if (item.thumbnailUrl) {
			results.push(
				InlineQueryResult.videoMp4(
					String(index),
					`Видео ${index + 1}`,
					item.url,
					item.thumbnailUrl,
					{
						caption,
					},
				),
			);
		}
	}
	return results;
}

function commentResults(
	comment: TrashboxComment,
	sourceUrl: string,
): TelegramInlineQueryResult[] {
	// Always a text article — comment images are embedded as clickable links.
	const message = buildCommentMessage(comment, sourceUrl);
	const text = message.toString();
	return [
		InlineQueryResult.article(
			"0",
			`Комментарий @${comment.login}`,
			InputMessageContent.text(text, { entities: message.entities }),
			{
				url: sourceUrl,
				description: text.split("\n").find(Boolean)?.slice(0, 100),
			},
		),
	];
}

export const inlineComposer = new Composer()
	.extend(composer)
	.inlineQuery(/https?:\/\/\S+/i, async (context) => {
		const commentUrl = findCommentUrl(context.query);
		if (commentUrl) {
			try {
				const { topicId, commentId, host } =
					await resolveCommentUrl(commentUrl);
				const comment = await fetchComment(topicId, commentId, host);
				if (comment) {
					return context.answer(
						commentResults(comment, commentUrl.toString()),
						ANSWER_OPTIONS,
					);
				}
			} catch {
				// Resolution failed — offer the chat as a fallback.
			}
			return context.answer([], { ...ANSWER_OPTIONS, button: OPEN_BOT_BUTTON });
		}

		const url = findMediaUrl(context.query);
		if (!url) return context.answer([], ANSWER_OPTIONS);

		try {
			const cached = mediaCache.get(url.toString());
			if (cached) {
				const caption = buildCaption(cached.metadata, url.toString());
				const result =
					cached.kind === "photo"
						? InlineQueryResult.cached.photo("0", cached.fileId, { caption })
						: InlineQueryResult.cached.video(
								"0",
								cached.metadata.title ?? "Видео",
								cached.fileId,
								{
									caption,
								},
							);
				return context.answer([result], ANSWER_OPTIONS);
			}

			const direct = await resolveProvider(url)?.resolveDirect?.(url);
			if (direct && direct.items.length > 0) {
				return context.answer(
					toInlineResults(direct, url.toString()),
					ANSWER_OPTIONS,
				);
			}
		} catch {
			// Resolution failed — offer the chat as a fallback.
		}

		return context.answer([], { ...ANSWER_OPTIONS, button: OPEN_BOT_BUTTON });
	});
