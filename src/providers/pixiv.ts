import { rm } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.ts";
import { downloadTo, fetchJson } from "./http.ts";
import type {
	DirectMediaItem,
	DirectMediaResult,
	MediaItem,
	MediaMetadata,
	Provider,
	ProviderResult,
} from "./types.ts";

export class PixivError extends Error {}

const PIXIV_ORIGIN = "https://www.pixiv.net";

const IMG_HEADERS: Record<string, string> = {
	Referer: PIXIV_ORIGIN,
	...((config.PIXIV_COOKIE && {
		Cookie: `PHPSESSID=${config.PIXIV_COOKIE}`,
	}) as Record<string, string>),
};

/** Extracts the artwork id from pixiv.net URLs, or `null` if not a pixiv link. */
export function extractIllustId(url: URL): string | null {
	if (!url.hostname.endsWith("pixiv.net")) return null;
	const artworks = url.pathname.match(/\/artworks\/(\d+)\/?$/);
	if (artworks) return artworks[1] ?? null;
	if (url.pathname.startsWith("/member_illust.php")) {
		return url.searchParams.get("illust_id");
	}
	return null;
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

async function fetchAjax<T>(url: string): Promise<T> {
	const body = await fetchJson<{
		error: boolean;
		message?: string;
		body: T | null;
	}>(url, { headers: IMG_HEADERS });
	if (body.error || body.body === null) {
		throw new PixivError(
			body.message ||
				"Иллюстрация недоступна (возможно R-18 — нужен PIXIV_COOKIE)",
		);
	}
	return body.body;
}

function extensionOf(url: string): string {
	const ext = url.split(".").at(-1)?.toLowerCase();
	return ext && /^[a-z0-9]+$/.test(ext) ? `.${ext}` : ".jpg";
}

/** Fetches illust metadata + page URLs. Shared by chat downloads and inline mode. */
async function fetchIllust(
	id: string,
): Promise<{ illust: IllustBody; pages: PageBody[] }> {
	const illust = await fetchAjax<IllustBody>(
		`${PIXIV_ORIGIN}/ajax/illust/${id}`,
	);
	if (illust.illustType === 2) {
		throw new PixivError(
			"Анимированные иллюстрации (ugoira) пока не поддерживаются",
		);
	}

	const pages = await fetchAjax<PageBody[]>(
		`${PIXIV_ORIGIN}/ajax/illust/${id}/pages`,
	);
	if (pages.length === 0) throw new PixivError("В иллюстрации нет изображений");

	return { illust, pages };
}

function metadataOf(illust: IllustBody): MediaMetadata {
	return {
		title: illust.illustTitle,
		author:
			illust.userName && illust.userId
				? {
						displayName: illust.userName,
						handle: illust.userId,
						profileUrl: `https://www.pixiv.net/user/${illust.userId}`,
					}
				: illust.userName
					? { displayName: illust.userName }
					: undefined,
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
	const id = extractIllustId(url);
	if (!id) throw new PixivError("Не удалось распознать ссылку Pixiv");
	if (!config.PIXIV_INLINE_PROXY) {
		throw new PixivError("Pixiv инлайн-режим отключён");
	}

	const { illust, pages } = await fetchIllust(id);
	const items: DirectMediaItem[] = pages.map((page) => {
		const src = config.PIXIV_COOKIE ? page.urls.original : page.urls.regular;
		if (!src) throw new PixivError("Не удалось получить ссылку на изображение");
		return { kind: "photo" as const, url: proxyImageUrl(src) };
	});

	return { metadata: metadataOf(illust), items };
}

export const pixivProvider: Provider = {
	name: "pixiv",
	sites: ["Pixiv"],
	match: (url) => extractIllustId(url) !== null,
	async fetch(url, downloadDir): Promise<ProviderResult> {
		const id = extractIllustId(url);
		if (!id) throw new PixivError("Не удалось распознать ссылку Pixiv");

		const { illust, pages } = await fetchIllust(id);

		// Sequential — i.pximg.net throttles parallel connections from one IP
		const items: MediaItem[] = [];
		try {
			for (const [index, page] of pages.entries()) {
				const src = config.PIXIV_COOKIE
					? page.urls.original
					: page.urls.regular;
				if (!src)
					throw new PixivError("Не удалось получить ссылку на изображение");

				const outPath = join(downloadDir, `${id}_${index}${extensionOf(src)}`);
				await downloadTo(src, outPath, { headers: IMG_HEADERS });
				items.push({ kind: "photo", path: outPath });
			}
		} catch (error) {
			await Promise.all(
				items.map((item) => rm(item.path, { force: true }).catch(() => {})),
			);
			throw error;
		}

		return {
			metadata: metadataOf(illust),
			items,
		};
	},
	async resolveDirect(url) {
		return resolveDirectPixiv(url);
	},
};
