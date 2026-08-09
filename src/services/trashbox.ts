import { markdownToFormattable } from "@gramio/format/markdown";
import { format } from "gramio";
import { NodeHtmlMarkdown } from "node-html-markdown";
import { buildCaption } from "../media/caption.ts";
import { fetchJson, fetchWithTimeout } from "../providers/http.ts";
import type { MediaMetadata } from "../providers/types.ts";

export class TrashboxError extends Error {}

const ACCEPTED_DOMAINS = new Set(["trashbox.ru", "redspecial.ru"]);

const URL_PATTERN = /https?:\/\/\S+/i;
const COMMENT_ANCHOR = /#div_comment_/;
const TRAILING_PUNCTUATION = /[.,!?;:)\]}>"']+$/;

export interface TrashboxComment {
	comm_id: string;
	parent: string;
	content: string;
	login: string;
	avatar: string;
	posted: string;
	votes: string;
}

interface CommentsResponse {
	comments: TrashboxComment[];
}

export interface CommentUrl {
	topicId: number;
	commentId: number;
	host: string;
}

/** Returns the first URL with a `#div_comment_` anchor in the text, or `null`. */
export function findCommentUrl(text: string): URL | null {
	const match = text.match(URL_PATTERN);
	if (!match) return null;
	try {
		const raw = match[0].replace(TRAILING_PUNCTUATION, "");
		const url = new URL(raw);
		return COMMENT_ANCHOR.test(url.hash) ? url : null;
	} catch {
		return null;
	}
}

/**
 * Resolves a comment URL to its topic and comment ids.
 * `link`-style slugs are expanded through the api_topics endpoint.
 */
export async function resolveCommentUrl(url: URL): Promise<CommentUrl> {
	const host = url.host;
	if (!ACCEPTED_DOMAINS.has(host))
		throw new TrashboxError("Некорректная ссылка");

	const pathParts = url.pathname.split("/").filter(Boolean);
	const commentId = parseInt(url.hash.split("_")[2] ?? "0", 10);
	if (pathParts.length < 2 || Number.isNaN(commentId) || commentId === 0)
		throw new TrashboxError("Некорректная ссылка");

	let topicId = 0;
	const topic = pathParts[1];
	if (pathParts[0] === "topics") {
		topicId = parseInt(topic ?? "0", 10);
	} else if (pathParts[0] === "link") {
		if (!topic || !/^[a-zA-Z0-9_-]+$/.test(topic))
			throw new TrashboxError("Некорректная ссылка");
		topicId = await resolveLinkTopicId(host, topic);
	} else {
		throw new TrashboxError("Некорректная ссылка");
	}

	if (topicId === 0)
		throw new TrashboxError("Некорректная ссылка или топик не найден");

	return { topicId, commentId, host };
}

/** Resolves a `link/`-slug to its topic id from the page's `data-topic-id`. */
async function resolveLinkTopicId(host: string, slug: string): Promise<number> {
	const response = await fetchWithTimeout(`https://${host}/link/${slug}`);
	const body = await response.text();
	const match = /data-topic-id=['"](\d+)['"]/.exec(body);
	return match ? parseInt(match[1] ?? "0", 10) : 0;
}

/** Fetches the comment by id, or `null` if it doesn't exist. */
export async function fetchComment(
	topicId: number,
	commentId: number,
	host: string,
): Promise<TrashboxComment | null> {
	const data = await fetchJson<CommentsResponse>(
		`https://${host}/api_noauth.php?action=comments&topic_id=${topicId}`,
	);
	return (
		data.comments.find(
			(comment) => parseInt(comment.comm_id, 10) === commentId,
		) ?? null
	);
}

const ALLOWED_TAGS = new Set([
	"b",
	"strong",
	"i",
	"em",
	"u",
	"s",
	"del",
	"strike",
	"code",
	"pre",
	"blockquote",
	"a",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"ul",
	"ol",
	"li",
	"br",
	"img",
]);

/**
 * Strips everything except a safe tag subset, then converts HTML to Markdown.
 * With `stripImages` the `<img>` tags are removed entirely — used when the
 * images are already sent as separate media.
 */
export function htmlCleaner(html: string, stripImages = false): string {
	html = html.replace(
		/<\/?([a-z][a-z0-9]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi,
		(match, tagName: string) =>
			ALLOWED_TAGS.has(tagName.toLowerCase()) ? match : "",
	);
	if (stripImages) {
		html = html.replace(/<img\b[^>]*>/gi, "");
	} else {
		// Images become clickable links with the URL as the label — the 🖼
		// emoji alone doesn't read as a link in a text message.
		html = html.replace(
			/<img\s+[^>]*src="(\/files\/[^"]+)"[^>]*>/gi,
			(_match, src: string) => {
				const absolute = `https://trashbox.ru${src}`;
				return `<img src="${absolute}" alt="🖼 ${absolute}">`;
			},
		);
	}
	return NodeHtmlMarkdown.translate(html);
}

/** First image URL in the comment body, or `null` — drives the link preview. */
export function firstImgSrc(html: string): string | null {
	const match = /<img\s+[^>]*src="([^"]+)"[^>]*>/i.exec(html);
	if (!match) return null;
	const src = match[1] ?? "";
	return src.startsWith("/files/") ? `https://trashbox.ru${src}` : src;
}

const LIGHTBOX_ATTR = /data-trash-lightbox2="([^"]+)"/i;
const SRC_ATTR = /src="([^"]+)"/i;

/** Full-size image URLs embedded in the comment body (preview → original). */
export function commentMediaSources(html: string): string[] {
	const urls: string[] = [];
	for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
		const lightbox = LIGHTBOX_ATTR.exec(tag)?.[1];
		const src = SRC_ATTR.exec(tag)?.[1];
		const raw = lightbox?.split(";")[2] ?? src;
		if (!raw) continue;
		const absolute = raw.startsWith("/") ? `https://trashbox.ru${raw}` : raw;
		if (/^https?:\/\//i.test(absolute)) urls.push(absolute);
	}
	return urls;
}

/** Builds the formatted comment message — same style as media captions. */
export function buildCommentMessage(
	comment: TrashboxComment,
	sourceUrl: string,
	includeImages = true,
): ReturnType<typeof format> {
	const votes = parseInt(comment.votes, 10);
	const metadata: MediaMetadata = {
		author: { displayName: comment.login },
		likes: votes !== 0 ? votes : undefined,
		date: comment.posted
			? new Date(parseInt(comment.posted, 10) * 1000).toISOString()
			: undefined,
	};
	return format`
		${buildCaption(metadata)}

		${markdownToFormattable(htmlCleaner(comment.content, !includeImages))}

		🔗 ${sourceUrl}
	`;
}
