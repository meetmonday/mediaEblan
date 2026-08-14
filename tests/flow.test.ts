import "./setup.ts";
import { afterAll, describe, expect, mock, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TelegramTestEnvironment } from "@gramio/test";
import { format } from "gramio";
import { bot } from "../src/bot.ts";
import { mediaCache } from "../src/media/cache.ts";
import { MediaError } from "../src/media/pipeline.ts";
import { HttpError } from "../src/providers/http.ts";
import type { Provider } from "../src/providers/types.ts";

const registryPath = join(import.meta.dir, "../src/providers/registry.ts");

// Provider is swapped per-test through `scenario`.
let scenario: "photo" | "video" | "multi" | "mixed" | "text" | "text-preview" =
	"photo";
const fakeProvider: Provider = {
	name: "fake",
	match: () => true,
	fetch: async (url, downloadDir) => {
		await mkdir(downloadDir, { recursive: true });
		if (scenario === "text" || scenario === "text-preview") {
			return {
				metadata: { author: { displayName: "Kekos" } },
				items: [],
				text: {
					content: format`Комментарий без медиа`,
					disableLinkPreview: scenario === "text",
					sourceUrl: url.toString(),
				},
			};
		}
		if (scenario === "video") {
			await writeFile(join(downloadDir, "item.mp4"), Buffer.alloc(1_024));
			return {
				metadata: {
					title: "Ролик про кота",
					author: { displayName: "VideoCat", handle: "video_cat" },
					date: "2026-08-01T12:00:00+09:00",
					likes: 12_345,
					views: 678_901,
				},
				items: [{ kind: "video", path: join(downloadDir, "item.mp4") }],
			};
		}
		if (scenario === "mixed") {
			await writeFile(
				join(downloadDir, "item-0.jpg"),
				Buffer.from("fake-jpeg"),
			);
			await writeFile(join(downloadDir, "item-1.mp4"), Buffer.alloc(1_024));
			return {
				metadata: {
					title: "Смешанный пост",
					author: { displayName: "Mixa", handle: "mixa" },
				},
				items: [
					{ kind: "photo", path: join(downloadDir, "item-0.jpg") },
					{ kind: "video", path: join(downloadDir, "item-1.mp4") },
				],
			};
		}
		const items = scenario === "multi" ? 2 : 1;
		const result = [];
		for (let i = 0; i < items; i++) {
			const name = `item-${i}.jpg`;
			await writeFile(join(downloadDir, name), Buffer.from("fake-jpeg"));
			result.push({ kind: "photo" as const, path: join(downloadDir, name) });
		}
		return {
			metadata: {
				title: "Солнечный день",
				author: { displayName: "ArtLover", handle: "art_lover" },
				date: "2026-08-01T12:00:00+09:00",
				likes: 1_234_567,
				views: 9_876_543,
				bookmarks: 88_000,
				retweets: 1_200,
				replies: 42,
				tags: ["солнце", "пейзаж"],
			},
			items: result,
		};
	},
};

mock.module(registryPath, () => ({
	providers: [],
	listSupportedSites: () => ["Example"],
	supportedSitesText: () => "• Example",
	findMediaUrl: (text: string) => {
		const raw = text.match(/https?:\/\/\S+/i)?.[0];
		if (!raw) return null;
		const url = new URL(raw);
		return url.hostname.endsWith("example.com") ? url : null;
	},
	resolveProvider: (url: URL) =>
		url.hostname === "example.com" ? fakeProvider : null,
}));

afterAll(() =>
	rm("/tmp/opencode/test-media", { recursive: true, force: true }),
);

function makeEnv() {
	const env = new TelegramTestEnvironment(bot);
	const user = env.createUser({ first_name: "Tester" });
	return { env, user };
}

describe("flow: chat media", () => {
	test("photo link → sendPhoto with full caption", async () => {
		scenario = "photo";
		const { env, user } = makeEnv();

		await user.sendMessage("https://example.com/photo");

		const call = env.lastApiCall("sendPhoto");
		expect(call).toBeDefined();
		expect(call?.params.caption?.toString()).toContain("Солнечный день");
		expect(call?.params.caption?.toString()).toContain(
			"👤 ArtLover (@art_lover)",
		);
		expect(call?.params.caption?.toString()).toContain("❤️ 1,2M");
		expect(call?.params.caption?.toString()).toContain("🔖 88K");
		expect(call?.params.caption?.toString()).toContain("🗓 01.08 03:00");
		expect(call?.params.caption?.toString()).toContain("#солнце #пейзаж");
	});

	test("video link → sendVideo with caption", async () => {
		scenario = "video";
		const { env, user } = makeEnv();

		await user.sendMessage("https://example.com/video");

		const call = env.lastApiCall("sendVideo");
		expect(call).toBeDefined();
		expect(call?.params.caption?.toString()).toContain("Ролик про кота");
		expect(call?.params.caption?.toString()).toContain(
			"👤 VideoCat (@video_cat)",
		);
	});

	test("text-only result → plain message with link preview disabled", async () => {
		scenario = "text";
		const { env, user } = makeEnv();

		await user.sendMessage("https://example.com/comment");

		const call = env.lastApiCall("sendMessage");
		expect(call).toBeDefined();
		expect(call?.params.text?.toString()).toContain("Комментарий без медиа");
		expect(call?.params.text?.toString()).toContain(
			"🔗 https://example.com/comment",
		);
		expect(call?.params.link_preview_options?.is_disabled).toBe(true);
		expect(env.filterApiCalls("sendPhoto")).toHaveLength(0);
	});

	test("text-only result with an image → link preview left enabled", async () => {
		scenario = "text-preview";
		const { env, user } = makeEnv();

		await user.sendMessage("https://example.com/comment-with-image");

		const call = env.lastApiCall("sendMessage");
		expect(call).toBeDefined();
		expect(call?.params.link_preview_options).toBeUndefined();
	});

	test("multi-image link → one media group, caption on the first item", async () => {
		scenario = "multi";
		const { env, user } = makeEnv();

		await user.sendMessage("https://example.com/album");

		const call = env.lastApiCall("sendMediaGroup");
		expect(call).toBeDefined();
		expect(env.filterApiCalls("sendPhoto")).toHaveLength(0);
		const media = call?.params.media;
		expect(media).toHaveLength(2);
		expect(media?.[0]?.type).toBe("photo");
		expect(media?.[0]?.caption?.toString()).toContain("Солнечный день");
		expect(media?.[1]?.caption).toBeUndefined();
	});

	test("mixed photo+video link → one media group in order", async () => {
		scenario = "mixed";
		const { env, user } = makeEnv();

		await user.sendMessage("https://example.com/mixed");

		const call = env.lastApiCall("sendMediaGroup");
		expect(call).toBeDefined();
		const media = call?.params.media;
		expect(media).toHaveLength(2);
		expect(media?.[0]?.type).toBe("photo");
		expect(media?.[0]?.caption?.toString()).toContain("Смешанный пост");
		expect(media?.[1]?.type).toBe("video");
	});

	test("unsupported provider → graceful ❌ reply", async () => {
		scenario = "photo";
		const { env, user } = makeEnv();

		await user.sendMessage("https://other.example.com/post");

		expect(env.lastApiCall("sendMessage")?.params.text).toBe(
			"❌ Поддерживаются ссылки:\n• Example",
		);
	});

	test("provider failure → graceful ❌ reply", async () => {
		scenario = "photo";
		const { env, user } = makeEnv();
		const original = fakeProvider.fetch;
		fakeProvider.fetch = async () => {
			throw new MediaError("download", "Сеть упала");
		};

		try {
			await user.sendMessage("https://example.com/broken");
		} finally {
			fakeProvider.fetch = original;
		}

		expect(env.lastApiCall("sendMessage")?.params.text).toBe("❌ Сеть упала");
	});

	test("transient network failure is retried once", async () => {
		scenario = "photo";
		const { env, user } = makeEnv();
		let calls = 0;
		const original = fakeProvider.fetch;
		fakeProvider.fetch = async (url, dir) => {
			calls++;
			if (calls === 1)
				throw new HttpError("Не удалось связаться с api.example.com");
			return original(url, dir);
		};

		try {
			await user.sendMessage("https://example.com/retry");
		} finally {
			fakeProvider.fetch = original;
		}

		expect(calls).toBe(2);
		expect(env.lastApiCall("sendPhoto")).toBeDefined();
	});

	test("persistent network failure → friendly ❌ reply", async () => {
		scenario = "photo";
		const { env, user } = makeEnv();
		const original = fakeProvider.fetch;
		fakeProvider.fetch = async () => {
			throw new HttpError("Не удалось связаться с api.example.com");
		};

		try {
			await user.sendMessage("https://example.com/down");
		} finally {
			fakeProvider.fetch = original;
		}

		expect(env.lastApiCall("sendMessage")?.params.text).toBe(
			"❌ Не удалось связаться с api.example.com",
		);
	});

	test("plain text without a link → no reply", async () => {
		const { env, user } = makeEnv();
		await user.sendMessage("просто привет");

		expect(env.apiCalls).toHaveLength(0);
	});
});

describe("flow: inline", () => {
	test("provider with direct URLs → photo/video results", async () => {
		const { env, user } = makeEnv();
		const original = fakeProvider.resolveDirect;
		fakeProvider.resolveDirect = async () => ({
			metadata: {
				title: "Пост с медиа",
				author: { displayName: "Twi", handle: "twi" },
			},
			items: [
				{ kind: "photo", url: "https://pbs.twimg.com/media/photo.jpg" },
				{
					kind: "video",
					url: "https://video.twimg.com/media/clip.mp4",
					thumbnailUrl: "https://pbs.twimg.com/media/photo.jpg",
				},
			],
		});

		try {
			await user.sendInlineQuery("https://example.com/inline");
		} finally {
			fakeProvider.resolveDirect = original;
		}

		const call = env.lastApiCall("answerInlineQuery");
		expect(call?.params.results).toHaveLength(2);
		expect(call?.params.button?.text).toBe("Открыть бот и вставить ссылку");
		// @ts-expect-error -- result is a discriminated union
		expect(call?.params.results[0]?.type).toBe("photo");
		// @ts-expect-error -- result is a discriminated union
		expect(call?.params.results[0]?.photo_url).toBe(
			"https://pbs.twimg.com/media/photo.jpg",
		);
		// @ts-expect-error -- result is a discriminated union
		expect(call?.params.results[1]?.type).toBe("video");
		// @ts-expect-error -- result is a discriminated union
		expect(call?.params.results[1]?.video_url).toBe(
			"https://video.twimg.com/media/clip.mp4",
		);
		// @ts-expect-error -- result is a discriminated union
		expect(call?.params.results[0]?.title).toBe("Пост с медиа");
		// @ts-expect-error -- result is a discriminated union
		expect(call?.params.results[1]?.title).toBe("Пост с медиа");
		// @ts-expect-error -- result is a discriminated union
		expect(call?.params.results[1]?.thumbnail_url).toBe(
			"https://pbs.twimg.com/media/photo.jpg",
		);
		// @ts-expect-error -- result is a discriminated union
		expect(call?.params.results[0]?.caption?.toString()).not.toContain("🔗");
		// @ts-expect-error -- result is a discriminated union
		const buttons = JSON.parse(
			JSON.stringify(call?.params.results[0]?.reply_markup),
		);
		expect(buttons.inline_keyboard[0].map((button) => button.text)).toEqual([
			"Открыть",
			"Поделиться",
		]);
		expect(buttons.inline_keyboard[0][0].url).toBe(
			"https://example.com/inline",
		);
	});

	test("provider without direct URLs → empty results + open-bot button", async () => {
		const { env, user } = makeEnv();

		await user.sendInlineQuery("https://example.com/pixiv-like");

		const call = env.lastApiCall("answerInlineQuery");
		expect(call?.params.results).toHaveLength(0);
		expect(call?.params.button?.text).toBe("Открыть бот и вставить ссылку");
	});

	test("fallback button token → /start processes the link in PM", async () => {
		const { env, user } = makeEnv();

		await user.sendInlineQuery("https://example.com/deep-link");

		const call = env.lastApiCall("answerInlineQuery");
		const token = call?.params.button?.start_parameter;
		expect(token).toBeTruthy();

		await user.sendCommand("start", token);

		expect(env.lastApiCall("sendPhoto")).toBeDefined();
		expect(env.filterApiCalls("replyWithPhoto")).toHaveLength(0);
		expect(env.lastApiCall("sendPhoto")?.params.caption?.toString()).toContain(
			"Солнечный день",
		);
		expect(
			env.lastApiCall("sendPhoto")?.params.caption?.toString(),
		).not.toContain("🔗");
		const buttons = JSON.parse(
			JSON.stringify(env.lastApiCall("sendPhoto")?.params.reply_markup),
		);
		expect(buttons.inline_keyboard[0].map((button) => button.text)).toEqual([
			"Открыть",
			"Поделиться",
		]);
		expect(buttons.inline_keyboard[0][0].url).toBe(
			"https://example.com/deep-link",
		);
		expect(buttons.inline_keyboard[0][1].url).toBe(
			"https://t.me/share/url?url=https%3A%2F%2Fexample.com%2Fdeep-link",
		);
		expect(env.filterApiCalls("deleteMessage")).toHaveLength(1);
	});

	test("deep-link text-only result → buttons instead of the source link line", async () => {
		scenario = "text";
		const { env, user } = makeEnv();

		await user.sendInlineQuery("https://example.com/text-deep-link");
		const token =
			env.lastApiCall("answerInlineQuery")?.params.button?.start_parameter;
		expect(token).toBeTruthy();

		await user.sendCommand("start", token);

		const call = env.lastApiCall("sendMessage");
		expect(call).toBeDefined();
		expect(call?.params.text?.toString()).toContain("Комментарий без медиа");
		expect(call?.params.text?.toString()).not.toContain("🔗");
		const buttons = JSON.parse(JSON.stringify(call?.params.reply_markup));
		expect(buttons.inline_keyboard[0].map((button) => button.text)).toEqual([
			"Открыть",
			"Поделиться",
		]);
		expect(buttons.inline_keyboard[0][0].url).toBe(
			"https://example.com/text-deep-link",
		);
	});

	test("cached media → cached photo result with file_id", async () => {
		mediaCache.set("https://example.com/cached", {
			kind: "photo",
			fileId: "file_id_123",
			metadata: { title: "Ранее отправлено" },
		});
		const { env, user } = makeEnv();

		await user.sendInlineQuery("https://example.com/cached");

		const call = env.lastApiCall("answerInlineQuery");
		expect(call?.params.results).toHaveLength(1);
		expect(call?.params.button?.text).toBe("Открыть бот и вставить ссылку");
		// @ts-expect-error -- result is a discriminated union
		expect(call?.params.results[0]?.type).toBe("photo");
		// @ts-expect-error -- result is a discriminated union
		expect(call?.params.results[0]?.photo_file_id).toBe("file_id_123");
		// @ts-expect-error -- result is a discriminated union
		expect(call?.params.results[0]?.reply_markup).toBeDefined();
	});

	test("query with a link-like text but unsupported host → empty results", async () => {
		const { env, user } = makeEnv();

		await user.sendInlineQuery("https://youtube.com/watch?v=x");

		const call = env.lastApiCall("answerInlineQuery");
		expect(call?.params.results).toHaveLength(0);
	});

	test("query without a link → no answerInlineQuery at all", async () => {
		const { env, user } = makeEnv();

		await user.sendInlineQuery("привет");

		expect(env.lastApiCall("answerInlineQuery")).toBeUndefined();
	});
});
