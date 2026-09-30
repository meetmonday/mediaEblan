import type { TelegramInlineQueryResult } from "@gramio/types";
import { InlineQueryResult, InputMessageContent } from "gramio";
import {
	findMediaUrl,
	resolveProvider,
	supportedSitesText,
} from "../providers/registry.ts";
import { findCommentUrl } from "../providers/trashbox/comment.ts";
import { commentResult, resolveComment } from "../providers/trashbox/index.ts";
import { pendingLinks } from "../services/pending-links.ts";
import { mediaCache } from "./cache.ts";
import { cachedResults, directResults, textResults } from "./inline.ts";

/** A query string resolved into the inline results it can be answered with. */
export interface ResolvedQuery {
	/** Ready-to-send results; empty when the query couldn't be served. */
	results: TelegramInlineQueryResult[];
	/**
	 * The recognised source link, offered to the user as a hand-off to the bot's
	 * own chat. Inline mode shows its «Открыть бот» button whenever it's set;
	 * guest mode falls back to it only when `results` came back empty.
	 */
	fallbackUrl?: string;
}

/**
 * Resolves a query into inline results without downloading anything: a
 * Trashbox comment becomes a text article, otherwise an already-sent `file_id`
 * is reused, otherwise the provider's direct media URLs are addressed. Anything
 * that would need a download yields no results plus a `fallbackUrl`, so both
 * the inline and the guest flow can offer the bot instead of failing silently.
 */
export async function resolveQuery(query: string): Promise<ResolvedQuery> {
	const commentUrl = findCommentUrl(query);
	if (commentUrl) {
		const sourceUrl = commentUrl.toString();
		try {
			// A Trashbox comment is always a text article — its images are
			// embedded as clickable links inside the message body.
			const comment = await resolveComment(commentUrl);
			return {
				results: textResults(commentResult(comment, sourceUrl), sourceUrl),
			};
		} catch {
			// Resolution failed — offer the chat as a fallback.
			return { results: [], fallbackUrl: sourceUrl };
		}
	}

	const url = findMediaUrl(query);
	if (!url) return { results: [] };

	const sourceUrl = url.toString();
	const cached = mediaCache.get(sourceUrl);
	if (cached) {
		return {
			results: cachedResults(cached, sourceUrl),
			fallbackUrl: sourceUrl,
		};
	}

	try {
		const direct = await resolveProvider(url)?.resolveDirect?.(url);
		if (direct && direct.items.length > 0) {
			return {
				results: directResults(direct, sourceUrl),
				fallbackUrl: sourceUrl,
			};
		}
	} catch {
		// Resolution failed — offer the chat as a fallback.
	}

	return { results: [], fallbackUrl: sourceUrl };
}

/** A `t.me` deep link that opens the bot's PM with the pending-link token. */
function botDeepLink(botUsername: string, sourceUrl: string): string {
	return `https://t.me/${botUsername}?start=${pendingLinks.set(sourceUrl)}`;
}

/**
 * The last resort when a query carries a link that can't be answered in place.
 * An article can't carry a `start_parameter` button (that field exists only on
 * `answerInlineQuery`), so the hand-off rides on the article's `url` — tapping
 * it opens the bot's PM, where `/start` picks the link up from `pendingLinks`
 * exactly like the inline fallback does.
 */
export function openBotResult(
	fallbackUrl: string | undefined,
	botUsername: string | undefined,
): TelegramInlineQueryResult {
	if (!fallbackUrl) {
		return InlineQueryResult.article(
			"open-bot",
			"Как пользоваться",
			InputMessageContent.text(
				`Пришлите ссылку — пришлю медиа.\n\nПоддерживаются:\n${supportedSitesText()}`,
			),
		);
	}

	const deepLink = botUsername ? botDeepLink(botUsername, fallbackUrl) : null;
	return InlineQueryResult.article(
		"open-bot",
		"Открыть бота",
		InputMessageContent.text(
			deepLink
				? "Пришлю это медиа в личке — откройте бота."
				: `Пришлю это медиа в личке — откройте бота и вставьте ссылку:\n${fallbackUrl}`,
		),
		{ url: deepLink ?? fallbackUrl },
	);
}
