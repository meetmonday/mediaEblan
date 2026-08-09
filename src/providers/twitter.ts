import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { Subprocess } from "bun";
import { downloadTo, fetchJson } from "./http.ts";
import type {
	DirectMediaItem,
	DirectMediaResult,
	MediaItem,
	Provider,
	ProviderResult,
} from "./types.ts";

export class TwitterError extends Error {}

const TWEET_ID_PATTERN = /\/status\/(\d+)/;

/** Extracts the tweet id from x.com / twitter.com URLs, or `null` if not a tweet link. */
export function extractTweetId(url: URL): string | null {
	if (url.hostname !== "twitter.com" && url.hostname !== "x.com") return null;
	return url.pathname.match(TWEET_ID_PATTERN)?.[1] ?? null;
}

interface FxTweet {
	text?: string;
	created_at?: string;
	author?: {
		name: string;
		screen_name: string;
	};
	likes?: number;
	retweets?: number;
	replies?: number;
	views?: number;
	bookmarks?: number;
	media?: {
		photos?: { url: string }[];
		videos?: { url: string; thumbnail_url?: string }[];
	};
}

interface FxResponse {
	code: number;
	message?: string;
	tweet?: FxTweet;
}

function truncate(text: string, max = 220): string {
	const trimmed = text.trim();
	return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

function metadataOf(tweet: FxTweet): ProviderResult["metadata"] {
	return {
		title: tweet.text ? truncate(tweet.text) : undefined,
		author: tweet.author
			? { displayName: tweet.author.name, handle: tweet.author.screen_name }
			: undefined,
		date: tweet.created_at,
		likes: tweet.likes,
		retweets: tweet.retweets,
		replies: tweet.replies,
		views: tweet.views,
		bookmarks: tweet.bookmarks,
	};
}

/** Fetches the tweet JSON via fxTwitter without downloading any media. */
async function fetchFxTweet(id: string): Promise<FxTweet | null> {
	let body: FxResponse;
	try {
		body = await fetchJson<FxResponse>(
			`https://api.fxtwitter.com/status/${id}`,
		);
	} catch {
		return null;
	}
	return body.tweet ?? null;
}

async function fetchViaFx(
	id: string,
	downloadDir: string,
): Promise<ProviderResult | null> {
	const tweet = await fetchFxTweet(id);
	if (!tweet) return null;

	const photos = tweet.media?.photos ?? [];
	const videos = tweet.media?.videos ?? [];
	if (photos.length === 0 && videos.length === 0) return null;

	const items: MediaItem[] = [];
	try {
		for (const [index, photo] of photos.entries()) {
			const outPath = join(downloadDir, `${id}_${index}.jpg`);
			await downloadTo(photo.url, outPath);
			items.push({ kind: "photo", path: outPath });
		}
		for (const [index, video] of videos.entries()) {
			const outPath = join(downloadDir, `${id}_v${index}.mp4`);
			await downloadTo(video.url, outPath);
			items.push({ kind: "video", path: outPath });
		}
	} catch (error) {
		await Promise.all(
			items.map((item) => rm(item.path, { force: true }).catch(() => {})),
		);
		throw error;
	}

	return { metadata: metadataOf(tweet), items };
}

function isVideoPath(path: string): boolean {
	return /\.(mp4|webm|mov|mkv)$/i.test(path);
}

async function fetchViaYtDlp(
	url: URL,
	downloadDir: string,
): Promise<ProviderResult> {
	const template = join(downloadDir, "%(id)s.%(ext)s");
	let proc: Subprocess<"pipe", "pipe", "pipe">;
	try {
		proc = Bun.spawn(
			[
				"yt-dlp",
				"-f",
				"bv*+ba/b",
				"--no-playlist",
				"--quiet",
				"--no-warnings",
				"-o",
				template,
				"--print",
				"after_move:filepath",
				url.toString(),
			],
			{ stdout: "pipe", stderr: "pipe" },
		);
	} catch {
		throw new TwitterError("yt-dlp не установлен — не могу скачать твит");
	}

	const exitCode = await proc.exited;
	const stdout = await new Response(proc.stdout).text();
	if (exitCode !== 0) {
		const stderr = await new Response(proc.stderr).text();
		const hint = stderr.trim().split("\n").at(-1);
		throw new TwitterError(
			hint ? `yt-dlp: ${hint}` : "yt-dlp не смог скачать твит",
		);
	}

	const paths = stdout
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	if (paths.length === 0) throw new TwitterError("В твите не найдено медиа");

	return {
		metadata: {},
		items: paths.map((path) => ({
			kind: isVideoPath(path) ? "video" : "photo",
			path,
		})),
	};
}

/** Resolves directly-embeddable media URLs (for inline mode) via fxTwitter. */
async function resolveDirectTweet(url: URL): Promise<DirectMediaResult> {
	const id = extractTweetId(url);
	if (!id) throw new TwitterError("Не удалось распознать ссылку на твит");

	const tweet = await fetchFxTweet(id);
	if (!tweet) throw new TwitterError("Не удалось получить твит");

	const photos = tweet.media?.photos ?? [];
	const videos = tweet.media?.videos ?? [];
	const thumbFallback = photos[0]?.url;

	const items: DirectMediaItem[] = [
		...photos.map((photo) => ({ kind: "photo" as const, url: photo.url })),
		...videos.flatMap((video) => {
			const thumbnail = video.thumbnail_url ?? thumbFallback;
			return thumbnail
				? [{ kind: "video" as const, url: video.url, thumbnailUrl: thumbnail }]
				: [];
		}),
	];
	if (items.length === 0) throw new TwitterError("В твите не найдено медиа");

	return { metadata: metadataOf(tweet), items };
}

export const twitterProvider: Provider = {
	name: "twitter",
	sites: ["X (Twitter)"],
	match: (url) => extractTweetId(url) !== null,
	async fetch(url, downloadDir): Promise<ProviderResult> {
		const id = extractTweetId(url);
		if (!id) throw new TwitterError("Не удалось распознать ссылку на твит");

		const fx = await fetchViaFx(id, downloadDir);
		if (fx) return fx;

		return fetchViaYtDlp(url, downloadDir);
	},
	async resolveDirect(url) {
		return resolveDirectTweet(url);
	},
};
