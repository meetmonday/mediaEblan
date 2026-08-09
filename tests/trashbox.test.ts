import "./setup.ts";
import { describe, expect, mock, test } from "bun:test";
import { join } from "node:path";
import { TelegramTestEnvironment } from "@gramio/test";
import { bot } from "../src/bot.ts";

const servicePath = join(import.meta.dir, "../src/services/trashbox.ts");
const httpPath = join(import.meta.dir, "../src/providers/http.ts");

const comment = {
	comm_id: "1426028",
	parent: "0",
	content:
		"<strong>Просто</strong> текст с <a href='https://example.com'>ссылкой</a>",
	login: "Тестер",
	avatar: "",
	posted: "1700000000",
	votes: "42",
};

const mediaComment = {
	...comment,
	content:
		"Скрин<br/><img src='/files/2555000_be982b/1001288496.jpg_min.jpg' data-trash-lightbox2='1600;2560;/files/2555000_be982b/1001288496.jpg;'/>",
};

class MockTrashboxError extends Error {}

let commentFound = true;
let useMediaComment = false;
let parseError: Error | null = null;

mock.module(httpPath, () => ({
	HttpError: class HttpError extends Error {},
	downloadTo: async (_url: string, outPath: string) => {
		await Bun.write(outPath, Buffer.from("fake-jpeg"));
	},
}));

mock.module(servicePath, () => ({
	TrashboxError: MockTrashboxError,
	findCommentUrl: (text: string) => {
		const match = text.match(/https?:\/\/\S+/i);
		if (!match) return null;
		const url = new URL(match[0]);
		return /#div_comment_/.test(url.hash) ? url : null;
	},
	resolveCommentUrl: async () => {
		if (parseError) throw parseError;
		return { topicId: 207704, commentId: 1426028, host: "trashbox.ru" };
	},
	fetchComment: async () =>
		commentFound ? (useMediaComment ? mediaComment : comment) : null,
	commentMediaSources: (html: string) =>
		html.includes("<img")
			? ["https://trashbox.ru/files/2555000_be982b/1001288496.jpg"]
			: [],
	firstImgSrc: () => null,
	buildCommentMessage: (_c, url) => `👤 ${_c.login} — ${url}`,
}));

describe("flow: trashbox comments", () => {
	test("comment link → formatted comment, user message kept", async () => {
		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser({ first_name: "Tester" });

		await user.sendMessage(
			"https://trashbox.ru/topics/207704/luchshij-brauzer#div_comment_1426028",
		);

		const call = env.lastApiCall("sendMessage");
		expect(call).toBeDefined();
		expect(call?.params.text).toContain("Тестер");
		expect(call?.params.link_preview_options?.is_disabled).toBe(true);
		expect(env.filterApiCalls("deleteMessage")).toHaveLength(0);
	});

	test("comment with an image → photo sent with the comment caption", async () => {
		useMediaComment = true;
		try {
			const env = new TelegramTestEnvironment(bot);
			const user = env.createUser({ first_name: "Tester" });

			await user.sendMessage(
				"https://trashbox.ru/topics/207704/luchshij-brauzer#div_comment_1426028",
			);

			const call = env.lastApiCall("sendPhoto");
			expect(call).toBeDefined();
			expect(call?.params.caption).toContain("Тестер");
			expect(env.lastApiCall("sendMessage")).toBeUndefined();
		} finally {
			useMediaComment = false;
		}
	});

	test("comment not found → error reply", async () => {
		commentFound = false;
		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser({ first_name: "Tester" });

		await user.sendMessage(
			"https://trashbox.ru/topics/207704/luchshij-brauzer#div_comment_9999999",
		);

		expect(env.lastApiCall("sendMessage")?.params.text).toBe(
			"❌ Комментарий не найден",
		);
	});

	test("invalid comment link → error reply", async () => {
		parseError = new MockTrashboxError("Некорректная ссылка");
		try {
			const env = new TelegramTestEnvironment(bot);
			const user = env.createUser({ first_name: "Tester" });

			await user.sendMessage("https://trashbox.ru/topics/207704#div_comment_");

			expect(env.lastApiCall("sendMessage")?.params.text).toBe(
				"❌ Некорректная ссылка",
			);
		} finally {
			parseError = null;
		}
	});

	test("plain text without a comment link → no reply", async () => {
		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser({ first_name: "Tester" });

		await user.sendMessage("просто привет");

		expect(env.apiCalls).toHaveLength(0);
	});
});
