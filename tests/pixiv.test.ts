import "./setup.ts";
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { pixivProvider, proxyImageUrl } from "../src/providers/pixiv.ts";

const illust = {
	illustType: 0,
	illustTitle: "Зимний вечер",
	userName: "Artem",
	userId: "100",
	viewCount: 10,
	likeCount: 5,
	bookmarkCount: 2,
	tags: { tags: [{ tag: "зима" }, { tag: "вечер" }] },
};

const pages = [
	{
		urls: {
			regular:
				"https://i.pximg.net/img-master/img/2026/01/01/00/00/00/123_p0_master1200.jpg",
			original:
				"https://i.pximg.net/img-original/img/2026/01/01/00/00/00/123_p0.png",
		},
	},
	{
		urls: {
			regular:
				"https://i.pximg.net/img-master/img/2026/01/01/00/00/00/123_p1_master1200.jpg",
			original:
				"https://i.pximg.net/img-original/img/2026/01/01/00/00/00/123_p1.png",
		},
	},
];

const realFetch = globalThis.fetch;

beforeAll(() => {
	globalThis.fetch = mock(async (url: RequestInfo | URL) => {
		const href = String(url);
		const body = href.includes("/pages") ? pages : illust;
		return new Response(JSON.stringify({ error: false, body }), {
			status: 200,
		});
	}) as typeof fetch;
});

afterAll(() => {
	globalThis.fetch = realFetch;
});

describe("pixiv resolveDirect", () => {
	test("rewrites i.pximg.net to the proxy host", () => {
		expect(
			proxyImageUrl(
				"https://i.pximg.net/img-original/img/2026/01/01/00/00/00/123_p0.png",
			),
		).toBe(
			"https://i.pixiv.re/img-original/img/2026/01/01/00/00/00/123_p0.png",
		);
	});

	test("returns proxied photo URLs with metadata", async () => {
		const result = await pixivProvider.resolveDirect?.(
			new URL("https://www.pixiv.net/artworks/123"),
		);

		expect(result).toBeDefined();
		expect(result?.items).toHaveLength(2);
		expect(result?.items[0]?.kind).toBe("photo");
		expect(result?.items[0]?.url.startsWith("https://i.pixiv.re/img-")).toBe(
			true,
		);
		expect(result?.items[1]?.url.startsWith("https://i.pixiv.re/img-")).toBe(
			true,
		);
		expect(result?.metadata.title).toBe("Зимний вечер");
		expect(result?.metadata.author?.displayName).toBe("Artem");
	});
});
