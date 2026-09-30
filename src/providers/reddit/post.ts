import { config } from "../../config.ts";
import { HttpError, NetworkError, ProviderError } from "../errors.ts";
import { epochToIso, makeAuthor } from "../helpers.ts";
import { fetchJson, fetchRedirect } from "../http.ts";
import type { MediaMetadata } from "../types.ts";

export const NAME = "reddit";
const UNPARSEABLE = "Не удалось распознать ссылку на Reddit";
const UNREACHABLE = "Не удалось получить пост — Reddit недоступен";

/** Shown when a post is reachable but carries no images or video. */
export const NO_MEDIA = "В посте не найдено медиа";

const REDDIT_ORIGIN = "https://www.reddit.com";
// Pushshift-style mirror — Reddit blocks most datacenter IPs, this one doesn't.
const ARCTIC_SHIFT_API = "https://arctic-shift.photon-reddit.com/api/posts/ids";

const MAX_REDIRECTS = 5;

const JSON_HEADERS: Record<string, string> = {
	"User-Agent": "mediaEblan/1.0 (telegram media bot)",
	Accept: "application/json",
	...((config.REDDIT_COOKIE && {
		Cookie: config.REDDIT_COOKIE,
	}) as Record<string, string>),
};

/** Headers every request to reddit.com (JSON API and media CDN) needs. */
export const REDDIT_HEADERS = JSON_HEADERS;

const PERMALINK_PATTERN = /\/(?:comments|gallery)\/([a-z0-9]+)/i;
const SHARE_PATTERN = /\/r\/[^/]+\/s\/([a-zA-Z0-9]+)/i;
const SHORTLINK_PATTERN = /^\/([a-z0-9]+)\/?$/i;

export interface RedditVideo {
	fallback_url?: string;
	dash_url?: string;
	has_audio?: boolean;
	is_gif?: boolean;
}

export interface RedditPost {
	id?: string;
	title?: string;
	author?: string;
	subreddit?: string;
	subreddit_name_prefixed?: string;
	created_utc?: number;
	score?: number;
	num_comments?: number;
	url?: string;
	is_video?: boolean;
	is_gallery?: boolean;
	secure_media?: { reddit_video?: RedditVideo };
	media?: { reddit_video?: RedditVideo };
	gallery_data?: { items?: { media_id?: string }[] };
	media_metadata?: Record<
		string,
		{ status?: string; e?: string; m?: string; s?: { u?: string } }
	>;
	preview?: { images?: { source?: { url?: string } }[] };
}

interface RedditListing {
	kind?: string;
	data?: { children?: { kind?: string; data?: RedditPost }[] };
}

/** Extracts the post id from permalink / gallery / redd.it URLs, or `null`. */
export function extractPostId(url: URL): string | null {
	if (url.hostname === "redd.it") {
		return url.pathname.match(SHORTLINK_PATTERN)?.[1] ?? null;
	}
	if (url.hostname.endsWith("reddit.com")) {
		return url.pathname.match(PERMALINK_PATTERN)?.[1] ?? null;
	}
	return null;
}

/** Parses a reddit post URL into `{ id }`, or `null` for share links / other hosts. */
export function parse(url: URL): { id: string } | null {
	const id = extractPostId(url);
	return id ? { id } : null;
}

export function isSupportedUrl(url: URL): boolean {
	if (url.hostname === "redd.it") return SHORTLINK_PATTERN.test(url.pathname);
	if (!url.hostname.endsWith("reddit.com")) return false;
	return (
		PERMALINK_PATTERN.test(url.pathname) || SHARE_PATTERN.test(url.pathname)
	);
}

/** `reddit.com/r/{sub}/s/{code}` short links redirect to the full permalink. */
async function resolveShareId(url: URL): Promise<string | null> {
	let current = url;
	for (let i = 0; i < MAX_REDIRECTS; i++) {
		const response = await fetchRedirect(current.toString(), {
			headers: JSON_HEADERS,
		});
		if (!response) return null;
		const location = response.headers.get("location");
		if (!location) return null;
		current = new URL(location, current);
		const parsed = parse(current);
		if (parsed) return parsed.id;
	}
	return null;
}

/** Resolves the post id, following /s/ share-link redirects when needed. */
export async function resolvePostId(url: URL): Promise<string> {
	const parsed = parse(url);
	if (parsed) return parsed.id;
	if (url.hostname.endsWith("reddit.com") && SHARE_PATTERN.test(url.pathname)) {
		const shared = await resolveShareId(url);
		if (shared) return shared;
	}
	throw new ProviderError(NAME, UNPARSEABLE);
}

/** The post's video descriptor, or `null` when it isn't a video post. */
export function redditVideo(post: RedditPost): RedditVideo | null {
	return post.secure_media?.reddit_video ?? post.media?.reddit_video ?? null;
}

export function metadataOf(post: RedditPost): MediaMetadata {
	return {
		title: post.title,
		author: makeAuthor({
			displayName: post.author,
			handle: post.author ? `u/${post.author}` : undefined,
			profileUrl: post.author
				? `https://www.reddit.com/user/${post.author}`
				: undefined,
		}),
		place:
			post.subreddit_name_prefixed ??
			(post.subreddit ? `r/${post.subreddit}` : undefined),
		date: post.created_utc ? epochToIso(post.created_utc) : undefined,
		likes: post.score,
		replies: post.num_comments,
	};
}

function firstPost(listings: RedditListing[]): RedditPost | null {
	if (!Array.isArray(listings)) return null;
	for (const listing of listings) {
		for (const child of listing?.data?.children ?? []) {
			if (child?.kind === "t3" && child.data) return child.data;
		}
	}
	return null;
}

async function fetchViaRedditApi(id: string): Promise<RedditPost | null> {
	const body = await fetchJson<RedditListing[]>(
		`${REDDIT_ORIGIN}/comments/${id}.json?raw_json=1`,
		{ headers: JSON_HEADERS },
	);
	return firstPost(body);
}

async function fetchViaArcticShift(id: string): Promise<RedditPost | null> {
	const body = await fetchJson<{ data?: RedditPost[] }>(
		`${ARCTIC_SHIFT_API}?ids=${id}`,
	);
	return body.data?.[0] ?? null;
}

/**
 * Reddit's own API first, Arctic Shift mirror as a datacenter-IP fallback.
 * An HTTP answer this source doesn't like (403 for a blocked IP, 404 for a
 * deleted post) is not fatal while another source is left to try. A transport
 * failure (timeout, reset) is remembered and rethrown only when every source
 * failed, so the pipeline still sees a retryable error instead of a dead end.
 */
async function fetchPostData(id: string): Promise<RedditPost> {
	let transportError: NetworkError | null = null;

	for (const fetchPost of [fetchViaRedditApi, fetchViaArcticShift]) {
		try {
			const post = await fetchPost(id);
			if (post) return post;
		} catch (error) {
			if (error instanceof NetworkError) transportError ??= error;
			if (!(error instanceof HttpError)) throw error;
		}
	}

	if (transportError) throw transportError;
	throw new ProviderError(NAME, UNREACHABLE);
}

export async function fetchPost(
	url: URL,
): Promise<{ id: string; post: RedditPost }> {
	const id = await resolvePostId(url);
	return { id, post: await fetchPostData(id) };
}
