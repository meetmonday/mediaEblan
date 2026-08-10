import "./setup.ts";
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { isTikTokUrl, tiktokProvider } from "../src/providers/tiktok.ts";

const downloadDir = join("/tmp/opencode/test-media", "tiktok");

const videoData = {
	id: "7658427639266299166",
	title: "Belle VS The Gachaverse #zzz",
	cover: "https://p16-common-sign.tiktokcdn-us.com/cover.jpeg",
	duration: 17,
	play: "https://v16m.tiktokcdn-us.com/video.mp4",
	play_count: 26_405,
	digg_count: 3_966,
	comment_count: 86,
	collect_count: 700,
	create_time: 1783116650,
	author: {
		id: "7288293807165785134",
		unique_id: "ruffescentral",
		nickname: "RuffesCentral",
	},
};

const imageData = {
	...videoData,
	images: [
		"https://p16-common-sign.tiktokcdn-us.com/img1.jpeg",
		"https://p16-common-sign.tiktokcdn-us.com/img2.jpeg",
	],
};

let kind: "video" | "images" = "video";

const realFetch = globalThis.fetch;

beforeAll(() => {
	globalThis.fetch = mock(async (input: RequestInfo | URL) => {
		const url = new URL(String(input));
		if (url.hostname === "www.tikwm.com") {
			return new Response(
				JSON.stringify({
					code: 0,
					msg: "success",
					data: kind === "images" ? imageData : videoData,
				}),
				{ status: 200 },
			);
		}
		if (url.hostname.endsWith("tiktokcdn-us.com")) {
			return new Response(Buffer.from("fake-media-bytes"), { status: 200 });
		}
		return new Response("not found", { status: 404 });
	}) as typeof fetch;
});

afterAll(async () => {
	globalThis.fetch = realFetch;
	await rm(downloadDir, { recursive: true, force: true });
});

describe("tiktok: URL matching", () => {
	test("matches full and short TikTok hosts", () => {
		expect(isTikTokUrl(new URL("https://www.tiktok.com/@user/video/123"))).toBe(
			true,
		);
		expect(isTikTokUrl(new URL("https://tiktok.com/@user/video/123"))).toBe(
			true,
		);
		expect(isTikTokUrl(new URL("https://vt.tiktok.com/ZS4C6dCgT/"))).toBe(true);
		expect(isTikTokUrl(new URL("https://vm.tiktok.com/ZS4C6dCgT/"))).toBe(true);
		expect(
			tiktokProvider.match(new URL("https://www.tiktok.com/@user/video/123")),
		).toBe(true);
	});

	test("rejects other hosts", () => {
		expect(isTikTokUrl(new URL("https://tiktokcdn.com/video.mp4"))).toBe(false);
		expect(isTikTokUrl(new URL("https://x.com/user/status/1"))).toBe(false);
	});
});

describe("tiktok: resolveDirect (inline)", () => {
	test("video post → video with thumbnail and metadata", async () => {
		kind = "video";
		const result = await tiktokProvider.resolveDirect?.(
			new URL("https://vt.tiktok.com/ZS4C6dCgT/"),
		);

		expect(result).toBeDefined();
		expect(result?.items).toHaveLength(1);
		expect(result?.items[0]?.kind).toBe("video");
		expect(result?.items[0]?.url).toBe(videoData.play);
		expect(result?.items[0]?.thumbnailUrl).toBe(videoData.cover);
		expect(result?.metadata.title).toBe("Belle VS The Gachaverse #zzz");
		expect(result?.metadata.author?.displayName).toBe("RuffesCentral");
		expect(result?.metadata.author?.handle).toBe("ruffescentral");
		expect(result?.metadata.likes).toBe(3_966);
		expect(result?.metadata.views).toBe(26_405);
	});

	test("image post → one photo per image", async () => {
		kind = "images";
		const result = await tiktokProvider.resolveDirect?.(
			new URL("https://www.tiktok.com/@user/video/7658427639266299166"),
		);

		expect(result?.items).toHaveLength(2);
		expect(result?.items[0]?.kind).toBe("photo");
		expect(result?.items[0]?.url).toBe(imageData.images?.[0]);
		expect(result?.items[1]?.url).toBe(imageData.images?.[1]);
	});
});

describe("tiktok: fetch (chat)", () => {
	test("video post → downloads the video", async () => {
		kind = "video";
		await mkdir(downloadDir, { recursive: true });
		const result = await tiktokProvider.fetch(
			new URL("https://vt.tiktok.com/ZS4C6dCgT/"),
			downloadDir,
		);

		expect(result.items).toHaveLength(1);
		expect(result.items[0]?.kind).toBe("video");
		expect(
			(await Bun.file(result.items[0]?.path ?? "").size) ?? 0,
		).toBeGreaterThan(0);
	});

	test("image post → downloads every image", async () => {
		kind = "images";
		const result = await tiktokProvider.fetch(
			new URL("https://www.tiktok.com/@user/video/7658427639266299166"),
			downloadDir,
		);

		expect(result.items).toHaveLength(2);
		expect(result.items.every((item) => item.kind === "photo")).toBe(true);
		expect(
			(await Bun.file(result.items[0]?.path ?? "").size) ?? 0,
		).toBeGreaterThan(0);
	});
});
