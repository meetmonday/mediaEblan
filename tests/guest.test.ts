import "./setup.ts";
import { describe, expect, mock, test } from "bun:test";
import { join } from "node:path";
import { TelegramTestEnvironment } from "@gramio/test";
import { bot } from "../src/bot.ts";
import { mediaCache } from "../src/media/cache.ts";
import type { Provider } from "../src/providers/types.ts";

const registryPath = join(import.meta.dir, "../src/providers/registry.ts");

const fakeProvider: Provider = {
	name: "fake",
	match: () => true,
	fetch: async () => {
		throw new Error("guest mode must never download");
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

function makeEnv() {
	return new TelegramTestEnvironment(bot);
}

/** Delivers a `guest_message` — a link sent in a chat the bot isn't in. */
async function guest(env: TelegramTestEnvironment, text: string) {
	await env.emitUpdate({
		update_id: 0,
		guest_message: {
			message_id: 1,
			date: 1_700_000_000,
			guest_query_id: "guest-query-1",
			chat: { id: -1001, type: "supergroup", title: "Чужой чат" },
			from: { id: 42, is_bot: false, first_name: "Гость" },
			text,
		},
	});
}

describe("flow: guest mode", () => {
	test("cached media → one cached photo result", async () => {
		mediaCache.set("https://example.com/guest-cached", {
			kind: "photo",
			fileId: "file_id_guest",
			metadata: { title: "Ранее отправлено" },
		});
		const env = makeEnv();

		await guest(env, "https://example.com/guest-cached");

		const call = env.lastApiCall("answerGuestQuery");
		expect(call).toBeDefined();
		expect(call?.params.guest_query_id).toBe("guest-query-1");
		// @ts-expect-error -- result is a discriminated union
		expect(call?.params.result.type).toBe("photo");
		// @ts-expect-error -- result is a discriminated union
		expect(call?.params.result.photo_file_id).toBe("file_id_guest");
		// A guest answer is never a send* call — the bot isn't in the chat.
		expect(env.filterApiCalls("sendPhoto")).toHaveLength(0);
		expect(env.filterApiCalls("sendMessage")).toHaveLength(0);
	});

	test("provider with direct URLs → only the first result is sent", async () => {
		const original = fakeProvider.resolveDirect;
		fakeProvider.resolveDirect = async () => ({
			metadata: { title: "Альбом", author: { displayName: "Twi" } },
			items: [
				{ kind: "photo", url: "https://cdn.example.com/1.jpg" },
				{ kind: "photo", url: "https://cdn.example.com/2.jpg" },
			],
		});
		const env = makeEnv();

		try {
			await guest(env, "https://example.com/guest-album");
		} finally {
			fakeProvider.resolveDirect = original;
		}

		const result = env.lastApiCall("answerGuestQuery")?.params.result;
		// @ts-expect-error -- result is a discriminated union
		expect(result.type).toBe("photo");
		// @ts-expect-error -- result is a discriminated union
		expect(result.photo_url).toBe("https://cdn.example.com/1.jpg");
	});

	test("provider that needs a download → article handing the link over", async () => {
		const env = makeEnv();

		await guest(env, "https://example.com/needs-download");

		const result = env.lastApiCall("answerGuestQuery")?.params.result;
		// @ts-expect-error -- result is a discriminated union
		expect(result.type).toBe("article");
		// @ts-expect-error -- result is a discriminated union
		expect(result.url).toBe("https://example.com/needs-download");
		// @ts-expect-error -- result is a discriminated union
		expect(result.input_message_content.message_text).toContain(
			"https://example.com/needs-download",
		);
	});

	test("guest message without a link → supported-sites hint", async () => {
		const env = makeEnv();

		await guest(env, "привет");

		const result = env.lastApiCall("answerGuestQuery")?.params.result;
		// @ts-expect-error -- result is a discriminated union
		expect(result.type).toBe("article");
		// @ts-expect-error -- result is a discriminated union
		expect(result.url).toBeUndefined();
		// @ts-expect-error -- result is a discriminated union
		expect(result.input_message_content.message_text).toContain("• Example");
	});

	test("guest query id missing → no answer at all", async () => {
		const env = makeEnv();

		await env.emitUpdate({
			update_id: 0,
			guest_message: {
				message_id: 1,
				date: 1_700_000_000,
				chat: { id: -1001, type: "supergroup", title: "Чужой чат" },
				from: { id: 42, is_bot: false, first_name: "Гость" },
				text: "https://example.com/guest-cached",
			},
		});

		expect(env.lastApiCall("answerGuestQuery")).toBeUndefined();
	});

	test("provider failure → still answers, never throws", async () => {
		const original = fakeProvider.resolveDirect;
		fakeProvider.resolveDirect = async () => {
			throw new Error("сеть упала");
		};
		const env = makeEnv();

		try {
			await guest(env, "https://example.com/guest-broken");
		} finally {
			fakeProvider.resolveDirect = original;
		}

		const result = env.lastApiCall("answerGuestQuery")?.params.result;
		// @ts-expect-error -- result is a discriminated union
		expect(result.type).toBe("article");
	});
});
