import type { TelegramInlineQueryResult } from "@gramio/types";
import { InlineQueryResult, InputMessageContent } from "gramio";
import type {
	DirectMediaResult,
	MediaMetadata,
	ProviderResult,
} from "../providers/types.ts";
import { sourceButtons } from "../shared/keyboards/index.ts";
import type { CachedMedia } from "./cache.ts";
import { cachedCaption, captionFor, textResultCaption } from "./caption.ts";

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

/**
 * Inline results for media a provider can address by a public URL — Telegram
 * downloads it itself, so nothing is fetched here. The source link is dropped
 * from the caption in favour of the «Открыть»/«Поделиться» buttons.
 * Videos without a thumbnail are skipped: inline video results require one.
 */
export function directResults(
	{ metadata, items, caption }: DirectMediaResult,
	sourceUrl: string,
): TelegramInlineQueryResult[] {
	const captionText = captionFor(metadata, {
		options: caption,
		includeSourceLink: false,
	}).build();
	const replyMarkup = sourceButtons(sourceUrl);

	const results: TelegramInlineQueryResult[] = [];
	for (const [index, item] of items.entries()) {
		if (item.kind === "photo") {
			results.push(
				InlineQueryResult.photo(
					String(index),
					item.url,
					item.thumbnailUrl ?? item.url,
					{
						caption: captionText,
						title: resultTitle(metadata, "Фото", index),
						reply_markup: replyMarkup,
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
					{ caption: captionText, reply_markup: replyMarkup },
				),
			);
		}
	}
	return results;
}

/** A media file the bot already sent once — re-used as a cached file_id. */
export function cachedResults(
	cached: CachedMedia,
	sourceUrl: string,
): TelegramInlineQueryResult[] {
	const replyMarkup = sourceButtons(sourceUrl);
	const params = {
		caption: cachedCaption(cached, { includeSourceLink: false }),
		reply_markup: replyMarkup,
	};
	const [result] =
		cached.kind === "photo"
			? [InlineQueryResult.cached.photo("0", cached.fileId, params)]
			: [
					InlineQueryResult.cached.video(
						"0",
						cached.metadata.title ?? "Видео",
						cached.fileId,
						params,
					),
				];
	return [result];
}

/**
 * A text-only result (a comment without media) as an inline article. The body
 * is always a text article — embedded images become clickable links inside it.
 */
export function textResults(
	result: ProviderResult,
	sourceUrl: string,
): TelegramInlineQueryResult[] {
	if (!result.text) return [];

	const message = textResultCaption(result, { includeSourceLink: false });
	const text = message.toString();
	return [
		InlineQueryResult.article(
			"0",
			result.text.title ?? "Текст",
			InputMessageContent.text(text, { entities: message.entities }),
			{
				url: sourceUrl,
				reply_markup: sourceButtons(sourceUrl),
				description: text.split("\n").find(Boolean)?.slice(0, 100),
			},
		),
	];
}
