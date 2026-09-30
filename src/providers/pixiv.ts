import { config } from "../config.ts";
import { ProviderError } from "./errors.ts";
import { downloadMediaSources, makeAuthor, mediaSources } from "./helpers.ts";
import { fetchJson } from "./http.ts";
import type {
	DirectMediaItem,
	DirectMediaResult,
	MediaMetadata,
	Provider,
	ProviderResult,
} from "./types.ts";

const NAME = "pixiv";
const UNPARSEABLE = "Не удалось распознать ссылку Pixiv";
const NO_IMAGE_URL = "Не удалось получить ссылку на изображение";

const PIXIV_ORIGIN = "https://www.pixiv.net";

const IMG_HEADERS: Record<string, string> = {
	Referer: PIXIV_ORIGIN,
	...((config.PIXIV_COOKIE && {
		Cookie: `PHPSESSID=${config.PIXIV_COOKIE}`,
	}) as Record<string, string>),
};

/** Parses a pixiv.net artwork URL into `{ id }`, or `null` for other links. */
export function parse(url: URL): { id: string } | null {
	if (!url.hostname.endsWith("pixiv.net")) return null;
	const artworks = url.pathname.match(/\/artworks\/(\d+)\/?$/);
	if (artworks) return artworks[1] ? { id: artworks[1] } : null;
	if (url.pathname.startsWith("/member_illust.php")) {
		const id = url.searchParams.get("illust_id");
		return id ? { id } : null;
	}
	return null;
}

/** Artwork id from an URL, or a semantic error the user can act on. */
function illustId(url: URL): string {
	const parsed = parse(url);
	if (!parsed) throw new ProviderError(NAME, UNPARSEABLE);
	return parsed.id;
}

interface IllustBody {
	illustType: number;
	illustTitle?: string;
	createDate?: string;
	userName?: string;
	userId?: string;
	viewCount?: number;
	likeCount?: number;
	bookmarkCount?: number;
	tags?: {
		tags: { tag: string }[];
	};
}

interface PageBody {
	urls: {
		regular?: string;
		original?: string;
	};
}

/**
 * Image URL of a page: the original resolution with a cookie configured,
 * the regular size otherwise.
 */
function pageUrl(page: PageBody): string {
	const src = config.PIXIV_COOKIE ? page.urls.original : page.urls.regular;
	if (!src) throw new ProviderError(NAME, NO_IMAGE_URL);
	return src;
}

async function fetchAjax<T>(url: string): Promise<T> {
	const body = await fetchJson<{
		error: boolean;
		message?: string;
		body: T | null;
	}>(url, { headers: IMG_HEADERS });
	if (body.error || body.body === null) {
		throw new ProviderError(
			NAME,
			body.message ||
				"Иллюстрация недоступна (возможно R-18 — нужен PIXIV_COOKIE)",
		);
	}
	return body.body;
}

/** Fetches illust metadata + page URLs. Shared by chat downloads and inline mode. */
async function fetchIllust(
	id: string,
): Promise<{ illust: IllustBody; pages: PageBody[] }> {
	const illust = await fetchAjax<IllustBody>(
		`${PIXIV_ORIGIN}/ajax/illust/${id}`,
	);
	if (illust.illustType === 2) {
		throw new ProviderError(
			NAME,
			"Анимированные иллюстрации (ugoira) пока не поддерживаются",
		);
	}

	const pages = await fetchAjax<PageBody[]>(
		`${PIXIV_ORIGIN}/ajax/illust/${id}/pages`,
	);
	if (pages.length === 0)
		throw new ProviderError(NAME, "В иллюстрации нет изображений");

	return { illust, pages };
}

function metadataOf(illust: IllustBody): MediaMetadata {
	return {
		title: illust.illustTitle,
		author: makeAuthor({
			displayName: illust.userName,
			handle: illust.userId,
			profileUrl: illust.userId
				? `https://www.pixiv.net/user/${illust.userId}`
				: undefined,
		}),
		date: illust.createDate,
		views: illust.viewCount,
		likes: illust.likeCount,
		bookmarks: illust.bookmarkCount,
		tags: (illust.tags?.tags ?? [])
			.map((tag) => tag.tag)
			.filter((tag) => tag.length > 0),
	};
}

/** Rewrites the host of an i.pximg.net URL to the configured reverse proxy. */
export function proxyImageUrl(src: string): string {
	const url = new URL(src);
	url.hostname = config.PIXIV_INLINE_PROXY;
	return url.toString();
}

async function resolveDirectPixiv(url: URL): Promise<DirectMediaResult> {
	const id = illustId(url);
	if (!config.PIXIV_INLINE_PROXY) {
		throw new ProviderError(NAME, "Pixiv инлайн-режим отключён");
	}

	const { illust, pages } = await fetchIllust(id);
	const items: DirectMediaItem[] = pages.map((page) => ({
		kind: "photo" as const,
		url: proxyImageUrl(pageUrl(page)),
	}));

	return { metadata: metadataOf(illust), items };
}

export const pixivProvider: Provider = {
	name: NAME,
	sites: ["Pixiv"],
	match: (url) => parse(url) !== null,
	async fetch(url, downloadDir): Promise<ProviderResult> {
		const id = illustId(url);
		const { illust, pages } = await fetchIllust(id);

		// Sequential — i.pximg.net throttles parallel connections from one IP.
		const items = await downloadMediaSources(
			mediaSources(id, pages.map(pageUrl)),
			downloadDir,
			{ headers: IMG_HEADERS, sequential: true },
		);

		return { metadata: metadataOf(illust), items };
	},
	async resolveDirect(url) {
		return resolveDirectPixiv(url);
	},
};
