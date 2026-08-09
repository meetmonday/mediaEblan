import "./setup.ts";
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { extractPostId, redditProvider } from "../src/providers/reddit.ts";

const downloadDir = join("/tmp/opencode/test-media", "reddit");

const imagePost = {
	id: "1vjg1zm",
	title: "Counting sheep always works",
	author: "Daniel_XXL_69",
	created_utc: 1744620642,
	score: 42,
	num_comments: 7,
	url: "https://i.redd.it/qgho1svoz9ih1.png",
};

const galleryPost = {
	id: "1vjzgdi",
	title: "Bald Meetup Los Angeles (OC)",
	author: "some_user",
	created_utc: 1744620642,
	score: 100,
	num_comments: 12,
	url: "https://www.reddit.com/gallery/1vjzgdi",
	is_gallery: true,
	gallery_data: {
		items: [{ media_id: "aa1111aaaaa1" }, { media_id: "bb2222bbbb2" }],
	},
	media_metadata: {
		aa1111aaaaa1: {
			status: "valid",
			e: "Image",
			m: "image/jpg",
			s: {
				u: "https://preview.redd.it/aa1111aaaaa1.jpg?width=100&format=pjpg&auto=webp&s=hash1",
			},
		},
		bb2222bbbb2: {
			status: "valid",
			e: "Image",
			m: "image/png",
			s: {
				u: "https://preview.redd.it/bb2222bbbb2.png?width=100&format=png&s=hash2",
			},
		},
	},
};

const videoPost = {
	id: "1vjz9tr",
	title: "Some video",
	author: "IntrepidShelter5974",
	created_utc: 1744620642,
	score: 300,
	num_comments: 50,
	url: "https://v.redd.it/vap2jkgtkeih1",
	is_video: true,
	secure_media: {
		reddit_video: {
			fallback_url:
				"https://v.redd.it/vap2jkgtkeih1/CMAF_720.mp4?source=fallback",
			dash_url: "https://v.redd.it/vap2jkgtkeih1/DASHPlaylist.mpd",
			has_audio: true,
			is_gif: false,
		},
	},
};

const textPost = {
	id: "1abc123",
	title: "Plain text post",
	author: "some_user",
	created_utc: 1744620642,
	score: 1,
	num_comments: 0,
	url: "https://www.reddit.com/r/example/comments/1abc123/plain_text/",
	selftext: "hello",
};

const posts: Record<string, object> = {
	"1vjg1zm": imagePost,
	"1vjzgdi": galleryPost,
	"1vjz9tr": videoPost,
	"1abc123": textPost,
};

function listingFor(post: object) {
	return JSON.stringify([
		{
			kind: "Listing",
			data: { children: [{ kind: "t3", data: post }] },
		},
	]);
}

const MANIFEST_XML = `<MPD><Period>
	<AdaptationSet mimeType="video/mp4"><BaseURL>CMAF_720.mp4</BaseURL></AdaptationSet>
	<AdaptationSet mimeType="audio/mp4"><BaseURL>CMAF_AUDIO_128.mp4</BaseURL></AdaptationSet>
</Period></MPD>`;

let redditBlocked = false;

const realFetch = globalThis.fetch;

beforeAll(() => {
	globalThis.fetch = mock(async (input: RequestInfo | URL) => {
		const url = new URL(String(input));
		const method = input instanceof Request ? input.method : "GET";

		if (url.hostname === "arctic-shift.photon-reddit.com") {
			const id = url.searchParams.get("ids");
			const post = id ? posts[id] : undefined;
			return new Response(JSON.stringify({ data: post ? [post] : [] }), {
				status: 200,
			});
		}

		if (url.hostname.endsWith("reddit.com")) {
			if (url.pathname.includes("/s/")) {
				return new Response(null, {
					status: 301,
					headers: {
						location:
							"https://www.reddit.com/r/antimeme/comments/1vjg1zm/counting_sheep/",
					},
				});
			}
			if (redditBlocked) return new Response("Forbidden", { status: 403 });
			const id = url.pathname.match(/comments\/([a-z0-9]+)/)?.[1];
			const post = id ? posts[id] : undefined;
			return new Response(post ? listingFor(post) : "not found", {
				status: post ? 200 : 404,
			});
		}

		if (url.hostname === "i.redd.it" || url.hostname === "preview.redd.it") {
			return new Response(Buffer.from("fake-image-bytes"), { status: 200 });
		}

		if (url.hostname === "v.redd.it") {
			if (url.pathname.includes("DASHPlaylist"))
				return new Response(MANIFEST_XML, { status: 200 });
			if (method === "HEAD") return new Response(null, { status: 200 });
			return new Response(Buffer.from("fake-video-bytes"), { status: 200 });
		}

		return new Response("not found", { status: 404 });
	}) as typeof fetch;
});

afterAll(async () => {
	globalThis.fetch = realFetch;
	await rm(downloadDir, { recursive: true, force: true });
});

describe("reddit: URL matching", () => {
	test("extracts id from permalinks and short forms", () => {
		expect(
			extractPostId(
				new URL("https://www.reddit.com/r/pics/comments/1abc123/title/"),
			),
		).toBe("1abc123");
		expect(extractPostId(new URL("https://reddit.com/gallery/1vjzgdi"))).toBe(
			"1vjzgdi",
		);
		expect(
			extractPostId(new URL("https://old.reddit.com/r/a/comments/1def456/")),
		).toBe("1def456");
		expect(extractPostId(new URL("https://redd.it/1abc123"))).toBe("1abc123");
	});

	test("share links and non-reddit hosts return null synchronously", () => {
		expect(
			extractPostId(new URL("https://www.reddit.com/r/antimeme/s/afiyqnNADA")),
		).toBeNull();
		expect(
			extractPostId(new URL("https://i.redd.it/qgho1svoz9ih1.png")),
		).toBeNull();
		expect(extractPostId(new URL("https://x.com/user/status/1"))).toBeNull();
	});

	test("match accepts post URLs, rejects bare hosts and media hosts", () => {
		expect(
			redditProvider.match(
				new URL("https://www.reddit.com/r/pics/comments/1/"),
			),
		).toBe(true);
		expect(
			redditProvider.match(
				new URL("https://www.reddit.com/r/antimeme/s/afiyqnNADA"),
			),
		).toBe(true);
		expect(redditProvider.match(new URL("https://redd.it/1abc123"))).toBe(true);
		expect(redditProvider.match(new URL("https://www.reddit.com"))).toBe(false);
		expect(
			redditProvider.match(new URL("https://i.redd.it/qgho1svoz9ih1.png")),
		).toBe(false);
	});
});

describe("reddit: resolveDirect (inline)", () => {
	test("image post → photo with metadata", async () => {
		const result = await redditProvider.resolveDirect?.(
			new URL("https://www.reddit.com/r/antimeme/comments/1vjg1zm/"),
		);

		expect(result).toBeDefined();
		expect(result?.items).toHaveLength(1);
		expect(result?.items[0]?.kind).toBe("photo");
		expect(result?.items[0]?.url).toBe("https://i.redd.it/qgho1svoz9ih1.png");
		expect(result?.metadata.title).toBe("Counting sheep always works");
		expect(result?.metadata.author?.handle).toBe("u/Daniel_XXL_69");
		expect(result?.metadata.likes).toBe(42);
		expect(result?.metadata.replies).toBe(7);
	});

	test("gallery post → one photo per image", async () => {
		const result = await redditProvider.resolveDirect?.(
			new URL("https://www.reddit.com/gallery/1vjzgdi"),
		);

		expect(result?.items).toHaveLength(2);
		expect(result?.items[0]?.url).toContain("preview.redd.it");
		expect(result?.items[0]?.url).toContain("&");
	});

	test("video post → no inline results (DASH has no audio track)", async () => {
		const result = await redditProvider.resolveDirect?.(
			new URL("https://www.reddit.com/r/videos/comments/1vjz9tr/"),
		);

		expect(result?.items).toHaveLength(0);
		expect(result?.metadata.title).toBe("Some video");
	});

	test("/s/ share link is resolved through the redirect", async () => {
		const result = await redditProvider.resolveDirect?.(
			new URL("https://www.reddit.com/r/antimeme/s/afiyqnNADA"),
		);

		expect(result?.items).toHaveLength(1);
		expect(result?.items[0]?.url).toBe("https://i.redd.it/qgho1svoz9ih1.png");
	});
});

describe("reddit: fetch (chat)", () => {
	test("image post → downloads the photo", async () => {
		await mkdir(downloadDir, { recursive: true });
		const result = await redditProvider.fetch(
			new URL("https://www.reddit.com/r/antimeme/comments/1vjg1zm/"),
			downloadDir,
		);

		expect(result.items).toHaveLength(1);
		expect(result.items[0]?.kind).toBe("photo");
		expect(
			(await Bun.file(result.items[0]?.path ?? "").size) ?? 0,
		).toBeGreaterThan(0);
	});

	test("gallery post → downloads every image", async () => {
		const result = await redditProvider.fetch(
			new URL("https://www.reddit.com/gallery/1vjzgdi"),
			downloadDir,
		);

		expect(result.items).toHaveLength(2);
		expect(result.items.every((item) => item.kind === "photo")).toBe(true);
	});

	test("text post → friendly no-media error", async () => {
		await expect(
			redditProvider.fetch(
				new URL("https://www.reddit.com/r/example/comments/1abc123/"),
				downloadDir,
			),
		).rejects.toThrow("В посте не найдено медиа");
	});

	test("video post → video item (audio merge degrades gracefully)", async () => {
		const result = await redditProvider.fetch(
			new URL("https://www.reddit.com/r/videos/comments/1vjz9tr/"),
			downloadDir,
		);

		expect(result.items).toHaveLength(1);
		expect(result.items[0]?.kind).toBe("video");
		expect(
			(await Bun.file(result.items[0]?.path ?? "").size) ?? 0,
		).toBeGreaterThan(0);
	});

	test("falls back to Arctic Shift when reddit's API is blocked", async () => {
		redditBlocked = true;
		try {
			const result = await redditProvider.fetch(
				new URL("https://www.reddit.com/r/antimeme/comments/1vjg1zm/"),
				downloadDir,
			);
			expect(result.items).toHaveLength(1);
		} finally {
			redditBlocked = false;
		}
	});
});
