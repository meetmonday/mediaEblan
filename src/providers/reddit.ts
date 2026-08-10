import { rm } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.ts";
import { muxAudio } from "../media/ffmpeg.ts";
import { ProviderError } from "./errors.ts";
import { downloadMediaSources, epochToIso, makeAuthor } from "./helpers.ts";
import {
	downloadTo,
	fetchJson,
	fetchRedirect,
	fetchWithTimeout,
} from "./http.ts";
import type {
	DirectMediaItem,
	DirectMediaResult,
	MediaItem,
	MediaMetadata,
	Provider,
	ProviderResult,
} from "./types.ts";

const REDDIT_ORIGIN = "https://www.reddit.com";
// Pushshift-style mirror — Reddit blocks most datacenter IPs, this one doesn't.
const ARCTIC_SHIFT_API = "https://arctic-shift.photon-reddit.com/api/posts/ids";

const JSON_HEADERS: Record<string, string> = {
	"User-Agent": "mediaEblan/1.0 (telegram media bot)",
	Accept: "application/json",
	...((config.REDDIT_COOKIE && {
		Cookie: config.REDDIT_COOKIE,
	}) as Record<string, string>),
};

const PERMALINK_PATTERN = /\/(?:comments|gallery)\/([a-z0-9]+)/i;
const SHARE_PATTERN = /\/r\/[^/]+\/s\/([a-zA-Z0-9]+)/i;
const SHORTLINK_PATTERN = /^\/([a-z0-9]+)\/?$/i;

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

function isSupportedUrl(url: URL): boolean {
	if (url.hostname === "redd.it") return SHORTLINK_PATTERN.test(url.pathname);
	if (!url.hostname.endsWith("reddit.com")) return false;
	return (
		PERMALINK_PATTERN.test(url.pathname) || SHARE_PATTERN.test(url.pathname)
	);
}

/** `reddit.com/r/{sub}/s/{code}` short links redirect to the full permalink. */
async function resolveShareId(url: URL): Promise<string | null> {
	let current = url;
	for (let i = 0; i < 5; i++) {
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
async function resolvePostId(url: URL): Promise<string | null> {
	const parsed = parse(url);
	if (parsed) return parsed.id;
	if (url.hostname.endsWith("reddit.com") && SHARE_PATTERN.test(url.pathname)) {
		return resolveShareId(url);
	}
	return null;
}

interface RedditListing {
	kind?: string;
	data?: { children?: { kind?: string; data?: RedditPost }[] };
}

interface RedditVideo {
	fallback_url?: string;
	dash_url?: string;
	has_audio?: boolean;
	is_gif?: boolean;
}

interface RedditPost {
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
	try {
		const body = await fetchJson<RedditListing[]>(
			`${REDDIT_ORIGIN}/comments/${id}.json?raw_json=1`,
			{ headers: JSON_HEADERS },
		);
		return firstPost(body);
	} catch {
		return null;
	}
}

async function fetchViaArcticShift(id: string): Promise<RedditPost | null> {
	try {
		const body = await fetchJson<{ data?: RedditPost[] }>(
			`${ARCTIC_SHIFT_API}?ids=${id}`,
		);
		return body.data?.[0] ?? null;
	} catch {
		return null;
	}
}

/** Reddit's own API first, Arctic Shift mirror as a datacenter-IP fallback. */
async function fetchPostData(id: string): Promise<RedditPost> {
	const viaReddit = await fetchViaRedditApi(id);
	if (viaReddit) return viaReddit;
	const viaMirror = await fetchViaArcticShift(id);
	if (viaMirror) return viaMirror;
	throw new ProviderError(
		"reddit",
		"Не удалось получить пост — Reddit недоступен",
	);
}

function metadataOf(post: RedditPost): MediaMetadata {
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

const MIME_EXT: Record<string, string> = {
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/gif": "gif",
	"image/webp": "webp",
};

function decodeEntities(value: string): string {
	return value.replaceAll("&amp;", "&");
}

function isImageUrl(value: string | undefined): boolean {
	return (
		value !== undefined && /\.(jpe?g|png|gif|webp|avif)(\?|$)/i.test(value)
	);
}

function galleryImageUrls(post: RedditPost): string[] {
	const urls: string[] = [];
	for (const item of post.gallery_data?.items ?? []) {
		if (!item.media_id) continue;
		const meta = post.media_metadata?.[item.media_id];
		if (meta?.status !== "valid") continue;
		if (meta.s?.u) {
			urls.push(decodeEntities(meta.s.u));
			continue;
		}
		const ext = MIME_EXT[meta.m ?? ""];
		if (ext) urls.push(`https://i.redd.it/${item.media_id}.${ext}`);
	}
	return urls;
}

function singleImageUrl(post: RedditPost): string | null {
	if (isImageUrl(post.url)) return post.url ?? null;
	const source = post.preview?.images?.[0]?.source?.url;
	return source && isImageUrl(source) ? decodeEntities(source) : null;
}

function redditVideo(post: RedditPost): RedditVideo | null {
	return post.secure_media?.reddit_video ?? post.media?.reddit_video ?? null;
}

function imageSources(post: RedditPost): string[] {
	if (post.is_gallery) return galleryImageUrls(post);
	const single = singleImageUrl(post);
	return single ? [single] : [];
}

function stripQuery(url: string): string {
	return url.split("?")[0] ?? url;
}

function videoBase(videoUrl: string): string {
	const url = new URL(videoUrl);
	const mediaId = url.pathname.split("/")[1];
	return `https://v.redd.it/${mediaId}`;
}

async function urlExists(url: string): Promise<boolean> {
	try {
		const response = await fetchWithTimeout(url, {
			headers: JSON_HEADERS,
			method: "HEAD",
		});
		return response.ok;
	} catch {
		return false;
	}
}

/** Finds the audio track URL: from the DASH manifest, then by guessing. */
async function findAudioUrl(video: RedditVideo): Promise<string | null> {
	if (video.dash_url) {
		const fromManifest = await audioUrlFromManifest(video.dash_url);
		if (fromManifest) return fromManifest;
	}
	if (!video.fallback_url) return null;
	const base = videoBase(video.fallback_url);
	for (const name of [
		"CMAF_AUDIO_128.mp4",
		"CMAF_AUDIO_64.mp4",
		"DASH_audio.mp4",
	]) {
		if (await urlExists(`${base}/${name}`)) return `${base}/${name}`;
	}
	return null;
}

async function audioUrlFromManifest(dashUrl: string): Promise<string | null> {
	try {
		const response = await fetchWithTimeout(dashUrl, { headers: JSON_HEADERS });
		const xml = await response.text();
		const match = xml.match(
			/mimeType="audio\/mp4"[^>]*>[\s\S]*?<BaseURL>([^<]+)<\/BaseURL>/,
		);
		return match?.[1] ? new URL(match[1], dashUrl).toString() : null;
	} catch {
		return null;
	}
}

async function downloadVideo(
	post: RedditPost,
	id: string,
	downloadDir: string,
): Promise<MediaItem> {
	const video = redditVideo(post);
	if (!video?.fallback_url)
		throw new ProviderError("reddit", "Не удалось получить ссылку на видео");

	const videoPath = join(downloadDir, `${id}_video.mp4`);
	await downloadTo(stripQuery(video.fallback_url), videoPath);

	if (!video.has_audio) return { kind: "video", path: videoPath };

	const audioUrl = await findAudioUrl(video);
	if (!audioUrl) return { kind: "video", path: videoPath };

	const audioPath = join(downloadDir, `${id}_audio.mp4`);
	try {
		await downloadTo(audioUrl, audioPath);
	} catch {
		return { kind: "video", path: videoPath };
	}

	const mergedPath = join(downloadDir, `${id}.mp4`);
	try {
		await muxAudio(videoPath, audioPath, mergedPath);
		await rm(audioPath, { force: true });
		await rm(videoPath, { force: true });
		return { kind: "video", path: mergedPath };
	} catch {
		await rm(audioPath, { force: true });
		return { kind: "video", path: videoPath };
	}
}

async function fetchReddit(
	url: URL,
	downloadDir: string,
): Promise<ProviderResult> {
	const id = await resolvePostId(url);
	if (!id)
		throw new ProviderError("reddit", "Не удалось распознать ссылку на Reddit");

	const post = await fetchPostData(id);
	const metadata = metadataOf(post);

	if (redditVideo(post)) {
		const item = await downloadVideo(post, id, downloadDir);
		return { metadata, items: [item] };
	}

	const sources = imageSources(post);
	if (sources.length === 0)
		throw new ProviderError("reddit", "В посте не найдено медиа");

	const items = await downloadMediaSources(
		sources.map((src, index) => ({ url: src, name: `${id}_${index}` })),
		downloadDir,
	);

	return { metadata, items };
}

async function resolveDirectReddit(url: URL): Promise<DirectMediaResult> {
	const id = await resolvePostId(url);
	if (!id)
		throw new ProviderError("reddit", "Не удалось распознать ссылку на Reddit");

	const post = await fetchPostData(id);
	const metadata = metadataOf(post);

	// DASH video files carry no audio track — direct inline won't work.
	if (redditVideo(post)) return { metadata, items: [] };

	const items: DirectMediaItem[] = imageSources(post).map((src) => ({
		kind: "photo" as const,
		url: src,
	}));

	return { metadata, items };
}

export const redditProvider: Provider = {
	name: "reddit",
	sites: ["Reddit"],
	match: (url) => isSupportedUrl(url),
	async fetch(url, downloadDir): Promise<ProviderResult> {
		return fetchReddit(url, downloadDir);
	},
	async resolveDirect(url) {
		return resolveDirectReddit(url);
	},
};
