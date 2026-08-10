import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	mock,
	test,
} from "bun:test";
import { exists, rm } from "node:fs/promises";
import { join } from "node:path";
import {
	downloadMediaSources,
	epochToIso,
	extensionOf,
	kindFromPath,
	makeAuthor,
} from "../src/providers/helpers.ts";

const TEMP_DIR = "/tmp/opencode/test-helpers";
const downloadDir = join(TEMP_DIR, "downloads");
const BYTES = Buffer.from("fake-bytes");

let failingUrl: string | null = null;

const realFetch = globalThis.fetch;
const fetchMock = mock(async (input: RequestInfo | URL) => {
	const url = String(input);
	if (url === failingUrl) return new Response("boom", { status: 500 });
	return new Response(BYTES);
}) as typeof fetch;

beforeAll(() => {
	globalThis.fetch = fetchMock;
});

beforeEach(() => rm(downloadDir, { recursive: true, force: true }));

afterAll(async () => {
	globalThis.fetch = realFetch;
	await rm(TEMP_DIR, { recursive: true, force: true });
});

describe("extensionOf", () => {
	test("extracts the extension from URL paths", () => {
		expect(extensionOf("https://example.com/a/photo.jpg")).toBe(".jpg");
		expect(extensionOf("https://example.com/video.mp4?t=5")).toBe(".mp4");
		expect(extensionOf("https://example.com/PHOTO.PNG")).toBe(".png");
	});

	test("defaults to .jpg for URLs without a plain extension", () => {
		expect(extensionOf("https://example.com/file")).toBe(".jpg");
		expect(extensionOf("https://example.com/a.b/c")).toBe(".jpg");
		expect(extensionOf("https://example.com/photo/")).toBe(".jpg");
	});
});

describe("makeAuthor", () => {
	test("builds an author from full info", () => {
		expect(
			makeAuthor({
				displayName: "Кекос",
				handle: "kekos",
				profileUrl: "https://trashbox.ru/users/kekos",
			}),
		).toEqual({
			displayName: "Кекос",
			handle: "kekos",
			profileUrl: "https://trashbox.ru/users/kekos",
		});
	});

	test("returns undefined without a display name", () => {
		expect(makeAuthor({ handle: "kekos" })).toBeUndefined();
		expect(makeAuthor({})).toBeUndefined();
	});

	test("keeps missing optional fields as undefined", () => {
		expect(makeAuthor({ displayName: "Кекос" })).toEqual({
			displayName: "Кекос",
			handle: undefined,
			profileUrl: undefined,
		});
	});
});

describe("epochToIso", () => {
	test("converts unix seconds to ISO 8601 UTC", () => {
		expect(epochToIso(0)).toBe("1970-01-01T00:00:00.000Z");
		expect(epochToIso(1_700_000_000)).toBe("2023-11-14T22:13:20.000Z");
	});
});

describe("kindFromPath", () => {
	test("video for common video extensions", () => {
		for (const path of ["a.mp4", "a.webm", "a.mov", "a.mkv", "A.MP4"]) {
			expect(kindFromPath(path)).toBe("video");
		}
	});

	test("photo for everything else", () => {
		expect(kindFromPath("a.jpg")).toBe("photo");
		expect(kindFromPath("a.png")).toBe("photo");
		expect(kindFromPath("no-extension")).toBe("photo");
	});
});

describe("downloadMediaSources", () => {
	test("downloads every source in parallel with inferred extensions", async () => {
		const items = await downloadMediaSources(
			[
				{ url: "https://example.com/a.png", name: "a" },
				{ url: "https://example.com/b.jpeg", name: "b" },
			],
			downloadDir,
		);

		expect(items).toHaveLength(2);
		expect(items.every((item) => item.kind === "photo")).toBe(true);
		expect(items.map((item) => item.path)).toEqual(
			expect.arrayContaining([
				join(downloadDir, "a.png"),
				join(downloadDir, "b.jpeg"),
			]),
		);
		for (const item of items) {
			expect(await Bun.file(item.path).size).toBe(BYTES.length);
		}
	});

	test("video kind forces an .mp4 path", async () => {
		const [item] = await downloadMediaSources(
			[{ url: "https://example.com/source.mp4", name: "clip", kind: "video" }],
			downloadDir,
		);

		expect(item?.kind).toBe("video");
		expect(item?.path).toBe(join(downloadDir, "clip.mp4"));
	});

	test("sequential downloads preserve source order", async () => {
		const items = await downloadMediaSources(
			[
				{ url: "https://example.com/first.png", name: "first" },
				{ url: "https://example.com/second.png", name: "second" },
			],
			downloadDir,
			{ sequential: true },
		);

		expect(items.map((item) => item.path)).toEqual([
			join(downloadDir, "first.png"),
			join(downloadDir, "second.png"),
		]);
	});

	test("passes headers to the download fetch", async () => {
		fetchMock.mockClear();
		await downloadMediaSources(
			[{ url: "https://example.com/h.png", name: "h" }],
			downloadDir,
			{ headers: { Referer: "https://pixiv.net" } },
		);

		const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
		expect(init?.headers).toEqual({ Referer: "https://pixiv.net" });
	});

	test("removes already-downloaded files when a later source fails", async () => {
		failingUrl = "https://example.com/third.png";
		try {
			await expect(
				downloadMediaSources(
					[
						{ url: "https://example.com/one.png", name: "one" },
						{ url: "https://example.com/two.png", name: "two" },
						{ url: failingUrl, name: "three" },
					],
					downloadDir,
					{ sequential: true },
				),
			).rejects.toThrow();
		} finally {
			failingUrl = null;
		}

		expect(await exists(join(downloadDir, "one.png"))).toBe(false);
		expect(await exists(join(downloadDir, "two.png"))).toBe(false);
	});
});
