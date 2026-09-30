import { join } from "node:path";
import { ProcError, runBinary } from "../services/proc.ts";
import { ProviderError } from "./errors.ts";
import {
	downloadMediaSources,
	epochToIso,
	kindFromPath,
	makeAuthor,
	mediaSources,
} from "./helpers.ts";
import { fetchJson } from "./http.ts";
import type {
	DirectMediaItem,
	DirectMediaResult,
	Provider,
	ProviderResult,
} from "./types.ts";

const NAME = "twitter";
const UNPARSEABLE = "Не удалось распознать ссылку на твит";
const NO_MEDIA = "В твите не найдено медиа";

const TWEET_ID_PATTERN = /\/status\/(\d+)/;

/** Parses an x.com / twitter.com status URL into `{ id }`, or `null` for other links. */
export function parse(url: URL): { id: string } | null {
	if (url.hostname !== "twitter.com" && url.hostname !== "x.com") return null;
	const id = url.pathname.match(TWEET_ID_PATTERN)?.[1];
	return id ? { id } : null;
}

/** Tweet id from a status URL, or a semantic error the user can act on. */
function postId(url: URL): string {
	const parsed = parse(url);
	if (!parsed) throw new ProviderError(NAME, UNPARSEABLE);
	return parsed.id;
}

interface FxTweet {
	text?: string;
	created_at?: string;
	/** Unix seconds — normalized to ISO in `metadataOf`. */
	created_timestamp?: number;
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
		author: makeAuthor({
			displayName: tweet.author?.name,
			handle: tweet.author?.screen_name,
			profileUrl: tweet.author
				? `https://x.com/${tweet.author.screen_name}`
				: undefined,
		}),
		date: tweet.created_timestamp
			? epochToIso(tweet.created_timestamp)
			: undefined,
		likes: tweet.likes,
		retweets: tweet.retweets,
		replies: tweet.replies,
		views: tweet.views,
		bookmarks: tweet.bookmarks,
	};
}

/** Photo and video attachments, always as arrays — shared by both flows. */
function mediaOf(tweet: FxTweet) {
	return {
		photos: tweet.media?.photos ?? [],
		videos: tweet.media?.videos ?? [],
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

	const { photos, videos } = mediaOf(tweet);
	if (photos.length === 0 && videos.length === 0) return null;

	const items = await downloadMediaSources(
		[
			...mediaSources(
				id,
				photos.map((photo) => photo.url),
				"photo",
			),
			...mediaSources(
				`${id}_v`,
				videos.map((video) => video.url),
				"video",
			),
		],
		downloadDir,
	);

	return { metadata: metadataOf(tweet), items };
}

async function fetchViaYtDlp(
	url: URL,
	downloadDir: string,
): Promise<ProviderResult> {
	const template = join(downloadDir, "%(id)s.%(ext)s");
	let stdout: string;
	try {
		({ stdout } = await runBinary(
			"yt-dlp",
			[
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
			"yt-dlp не установлен — не могу скачать твит",
		));
	} catch (error) {
		if (!(error instanceof ProcError)) throw error;
		throw new ProviderError(
			NAME,
			error.exitCode === null ? error.message : `yt-dlp: ${error.message}`,
		);
	}

	const paths = stdout
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	if (paths.length === 0) throw new ProviderError(NAME, NO_MEDIA);

	return {
		metadata: {},
		items: paths.map((path) => ({
			kind: kindFromPath(path),
			path,
		})),
	};
}

/** Resolves directly-embeddable media URLs (for inline mode) via fxTwitter. */
async function resolveDirectTweet(url: URL): Promise<DirectMediaResult> {
	const tweet = await fetchFxTweet(postId(url));
	if (!tweet) throw new ProviderError(NAME, "Не удалось получить твит");

	const { photos, videos } = mediaOf(tweet);
	// Videos without a thumbnail fall back to the first photo of the tweet.
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
	if (items.length === 0) throw new ProviderError(NAME, NO_MEDIA);

	return { metadata: metadataOf(tweet), items };
}

export const twitterProvider: Provider = {
	name: NAME,
	sites: ["X (Twitter)"],
	match: (url) => parse(url) !== null,
	async fetch(url, downloadDir): Promise<ProviderResult> {
		const fx = await fetchViaFx(postId(url), downloadDir);
		if (fx) return fx;

		return fetchViaYtDlp(url, downloadDir);
	},
	async resolveDirect(url) {
		return resolveDirectTweet(url);
	},
};
