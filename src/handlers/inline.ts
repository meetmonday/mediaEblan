import type { TelegramInlineQueryResult } from "@gramio/types";
import { Composer, InlineQueryResult, InputMessageContent } from "gramio";
import { mediaCache } from "../media/cache.ts";
import { buildCaption } from "../media/caption.ts";
import { composer } from "../plugins/index.ts";
import { findMediaUrl, resolveProvider } from "../providers/registry.ts";
import type { DirectMediaResult, MediaMetadata } from "../providers/types.ts";
import { pendingLinks } from "../services/pending-links.ts";
import type { TrashboxComment } from "../services/trashbox.ts";
import {
	buildCommentMessage,
	fetchComment,
	findCommentUrl,
	resolveCommentUrl,
} from "../services/trashbox.ts";

const ANSWER_OPTIONS = { cache_time: 0, is_personal: true } as const;

/**
 * Fallback button for links inline mode can't serve directly. The URL is
 * stored under a short token; pressing the button opens the bot PM and
 * sends `/start <token>`, which the start handler exchanges for the URL.
 */
function openBotButton(sourceUrl: string) {
	return {
		text: "Открыть бот и вставить ссылку",
		start_parameter: pendingLinks.set(sourceUrl),
	};
}

const TITLE_MAX = 60;

/** Short title for an inline result — the media title, the author, or a numbered fallback. */
function resultTitle(
	metadata: MediaMetadata,
	fallback: string,
	index: number,
): string {
	const source = metadata.title?.trim() || metadata.author?.displayName;
	if (source)
		return source.length > TITLE_MAX
			? `${source.slice(0, TITLE_MAX - 1)}…`
			: source;
	return `${fallback} ${index + 1}`;
}

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
						title: resultTitle(metadata, "Фото", index),
					},
				),
			);
		} else if (item.thumbnailUrl) {
			results.push(
				InlineQueryResult.videoMp4(
					String(index),
					resultTitle(metadata, "Видео", index),
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
			return context.answer([], {
				...ANSWER_OPTIONS,
				button: openBotButton(commentUrl.toString()),
			});
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
				return context.answer([result], {
					...ANSWER_OPTIONS,
					button: openBotButton(url.toString()),
				});
			}

			const direct = await resolveProvider(url)?.resolveDirect?.(url);
			if (direct && direct.items.length > 0) {
				return context.answer(toInlineResults(direct, url.toString()), {
					...ANSWER_OPTIONS,
					button: openBotButton(url.toString()),
				});
			}
		} catch {
			// Resolution failed — offer the chat as a fallback.
		}

		return context.answer([], {
			...ANSWER_OPTIONS,
			button: openBotButton(url.toString()),
		});
	});
