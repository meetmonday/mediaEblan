import "./setup.ts";
import { afterAll, describe, expect, test } from "bun:test";
import { TelegramTestEnvironment } from "@gramio/test";
import { bot } from "../src/bot.ts";

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
		"Скрин<br/><img src=\"/files/2555000_be982b/1001288496.jpg_min.jpg\" data-trash-lightbox2='1600;2560;/files/2555000_be982b/1001288496.jpg;'/>",
};

let commentFound = true;
let useMediaComment = false;

// The real trashbox service hits the trashbox API over the network. Mock the
// transport (`globalThis.fetch`) instead of the service module itself, so the
// unit tests in trashbox-unit.test.ts always see the real implementation.
const realFetch = globalThis.fetch;
const mockedFetch = async (input: RequestInfo | URL): Promise<Response> => {
	const url = String(input);
	if (url.includes("/api_noauth.php")) {
		const comments = commentFound
			? [useMediaComment ? mediaComment : comment]
			: [];
		return new Response(JSON.stringify({ comments }), {
			headers: { "content-type": "application/json" },
		});
	}
	if (url.includes("/files/")) return new Response("fake-jpeg");
	throw new Error(`Unexpected fetch in tests: ${url}`);
};
globalThis.fetch = mockedFetch as typeof fetch;

afterAll(() => {
	globalThis.fetch = realFetch;
});

describe("flow: trashbox comments", () => {
	test("comment link → formatted comment, user message kept", async () => {
		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser({ first_name: "Tester" });

		await user.sendMessage(
			"https://trashbox.ru/topics/207704/luchshij-brauzer#div_comment_1426028",
		);

		const call = env.lastApiCall("sendMessage");
		expect(call).toBeDefined();
		expect(call?.params.text?.toString()).toContain("Тестер");
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
			expect(call?.params.caption?.toString()).toContain("Тестер");
			expect(env.lastApiCall("sendMessage")).toBeUndefined();
		} finally {
			useMediaComment = false;
		}
	});

	test("comment not found → error reply", async () => {
		commentFound = false;
		try {
			const env = new TelegramTestEnvironment(bot);
			const user = env.createUser({ first_name: "Tester" });

			await user.sendMessage(
				"https://trashbox.ru/topics/207704/luchshij-brauzer#div_comment_9999999",
			);

			expect(env.lastApiCall("sendMessage")?.params.text).toBe(
				"❌ Комментарий не найден",
			);
		} finally {
			commentFound = true;
		}
	});

	test("invalid comment link → error reply", async () => {
		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser({ first_name: "Tester" });

		await user.sendMessage("https://trashbox.ru/topics/207704#div_comment_");

		expect(env.lastApiCall("sendMessage")?.params.text).toBe(
			"❌ Некорректная ссылка",
		);
	});

	test("plain text without a comment link → no reply", async () => {
		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser({ first_name: "Tester" });

		await user.sendMessage("просто привет");

		expect(env.apiCalls).toHaveLength(0);
	});
});
