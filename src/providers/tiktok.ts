import { ProviderError } from "./errors.ts";
import type { MediaSource } from "./helpers.ts";
import { downloadMediaSources, epochToIso, makeAuthor } from "./helpers.ts";
import { fetchJson } from "./http.ts";
import type {
	CaptionOptions,
	DirectMediaItem,
	DirectMediaResult,
	MediaMetadata,
	Provider,
	ProviderResult,
} from "./types.ts";

// Third-party scraper API — resolves TikTok links without cookies or headers.
const TIKWM_API = "https://www.tikwm.com/api/";

// TikTok CDNs are picky about the User-Agent on the final media URLs.
const MEDIA_HEADERS: Record<string, string> = {
	"User-Agent":
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};

/** TikTok is view-first — plays matter more than likes. */
const TIKTOK_CAPTION: CaptionOptions = {
	statsOrder: ["views", "likes", "bookmarks", "replies"],
};

/** Matches every tiktok.com host, including vt./vm. share short links. */
export function isTikTokUrl(url: URL): boolean {
	return url.hostname === "tiktok.com" || url.hostname.endsWith(".tiktok.com");
}

interface TikTokMediaData {
	id?: string;
	title?: string;
	cover?: string;
	play?: string;
	/** Present only for photo carousels. */
	images?: string[];
	play_count?: number;
	digg_count?: number;
	comment_count?: number;
	collect_count?: number;
	create_time?: number;
	author?: {
		unique_id?: string;
		nickname?: string;
	};
}

interface TikTokApiResponse {
	code?: number;
	msg?: string;
	data?: TikTokMediaData;
}

function metadataOf(data: TikTokMediaData): MediaMetadata {
	return {
		title: data.title,
		author: makeAuthor({
			displayName: data.author?.nickname,
			handle: data.author?.unique_id,
			profileUrl: data.author?.unique_id
				? `https://www.tiktok.com/@${data.author.unique_id}`
				: undefined,
		}),
		date: data.create_time ? epochToIso(data.create_time) : undefined,
		likes: data.digg_count,
		views: data.play_count,
		bookmarks: data.collect_count,
		replies: data.comment_count,
	};
}

/** Fetches video metadata via the tikwm scraper. Throws HttpError on network issues. */
async function fetchTikTokData(url: URL): Promise<TikTokMediaData> {
	const body = await fetchJson<TikTokApiResponse>(TIKWM_API, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ url: url.toString(), hd: 1 }),
	});
	if (!body.data) {
		throw new ProviderError(
			"tiktok",
			body.msg || "Видео не найдено или ссылка некорректная",
		);
	}
	return body.data;
}

async function fetchTikTok(
	url: URL,
	downloadDir: string,
): Promise<ProviderResult> {
	const data = await fetchTikTokData(url);
	const metadata = metadataOf(data);

	const sources: MediaSource[] =
		data.images && data.images.length > 0
			? data.images.map((src, index) => ({
					url: src,
					name: `${data.id ?? "tiktok"}_${index}`,
				}))
			: [];
	if (sources.length === 0) {
		if (!data.play)
			throw new ProviderError("tiktok", "В видео не найдено медиа");
		sources.push({ url: data.play, name: data.id ?? "tiktok", kind: "video" });
	}

	const items = await downloadMediaSources(sources, downloadDir, {
		headers: MEDIA_HEADERS,
	});

	return { metadata, items, caption: TIKTOK_CAPTION };
}

async function resolveDirectTikTok(url: URL): Promise<DirectMediaResult> {
	const data = await fetchTikTokData(url);
	const metadata = metadataOf(data);

	const items: DirectMediaItem[] = [];
	if (data.images && data.images.length > 0) {
		for (const src of data.images) {
			items.push({ kind: "photo", url: src });
		}
	} else if (data.play && data.cover) {
		items.push({ kind: "video", url: data.play, thumbnailUrl: data.cover });
	}
	if (items.length === 0)
		throw new ProviderError("tiktok", "В видео не найдено медиа");

	return { metadata, items, caption: TIKTOK_CAPTION };
}

export const tiktokProvider: Provider = {
	name: "tiktok",
	sites: ["TikTok"],
	match: (url) => isTikTokUrl(url),
	async fetch(url, downloadDir): Promise<ProviderResult> {
		return fetchTikTok(url, downloadDir);
	},
	async resolveDirect(url) {
		return resolveDirectTikTok(url);
	},
};
