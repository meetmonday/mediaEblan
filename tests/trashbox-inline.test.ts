import "./setup.ts";
import { afterAll, describe, expect, test } from "bun:test";
import { TelegramTestEnvironment } from "@gramio/test";
import { bot } from "../src/bot.ts";

const textComment = {
	comm_id: "1288345",
	parent: "0",
	content: "1ur",
	login: "kekos",
	avatar: "1939444_fe7997_big",
	posted: "1588529999",
	votes: "0",
};

const photoComment = {
	...textComment,
	content:
		"Помню<br/><img src=\"/files/2554043_184a9c/1000341956.webp.png\" data-trash-lightbox2='256;256;/files/2554043_184a9c/1000341956.webp.png;-thumb.jpg 90 90,-orig.jpg 256 256'/>",
};

let comment: typeof textComment | null = textComment;

// Mock only the transport so the real service logic (URL parsing, comment
// building) is exercised and trashbox-unit.test.ts keeps the real module.
const realFetch = globalThis.fetch;
const mockedFetch = async (input: RequestInfo | URL): Promise<Response> => {
	const url = String(input);
	if (url.includes("/link/")) {
		return new Response('<div data-topic-id="132125"></div>');
	}
	if (url.includes("/api_noauth.php")) {
		return new Response(
			JSON.stringify({ comments: comment ? [comment] : [] }),
			{
				headers: { "content-type": "application/json" },
			},
		);
	}
	if (url.includes("/files/")) return new Response("fake-jpeg");
	throw new Error(`Unexpected fetch in tests: ${url}`);
};
globalThis.fetch = mockedFetch as typeof fetch;

afterAll(() => {
	globalThis.fetch = realFetch;
});

describe("flow: inline trashbox comments", () => {
	test("comment with a photo → article with the image embedded as a text link", async () => {
		comment = photoComment;
		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser({ first_name: "Tester" });

		await user.sendInlineQuery(
			"https://trashbox.ru/link/oduvanchik-android#div_comment_1288345",
		);

		const call = env.lastApiCall("answerInlineQuery");
		expect(call).toBeDefined();
		expect(call?.params.results).toHaveLength(1);
		// @ts-expect-error -- result is a discriminated union
		expect(call?.params.results[0]?.type).toBe("article");
		// @ts-expect-error -- result is a discriminated union
		expect(
			call?.params.results[0]?.input_message_content?.message_text,
		).toContain("kekos");
		// @ts-expect-error -- result is a discriminated union
		expect(
			call?.params.results[0]?.input_message_content?.message_text,
		).toContain("https://trashbox.ru/files/2554043_184a9c/1000341956.webp.png");
		expect(call?.params.button).toBeUndefined();
	});

	test("comment without a photo → article result with the comment text", async () => {
		comment = textComment;
		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser({ first_name: "Tester" });

		await user.sendInlineQuery(
			"https://trashbox.ru/topics/132125/mm#div_comment_1288345",
		);

		const call = env.lastApiCall("answerInlineQuery");
		expect(call).toBeDefined();
		expect(call?.params.results).toHaveLength(1);
		// @ts-expect-error -- result is a discriminated union
		expect(call?.params.results[0]?.type).toBe("article");
		// @ts-expect-error -- result is a discriminated union
		expect(
			call?.params.results[0]?.input_message_content?.message_text,
		).toContain("kekos");
		// @ts-expect-error -- result is a discriminated union
		expect(call?.params.results[0]?.url).toBe(
			"https://trashbox.ru/topics/132125/mm#div_comment_1288345",
		);
	});

	test("comment resolution failure → empty results + open-bot button", async () => {
		comment = null;
		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser({ first_name: "Tester" });

		await user.sendInlineQuery(
			"https://trashbox.ru/topics/132125/mm#div_comment_9999999",
		);

		const call = env.lastApiCall("answerInlineQuery");
		expect(call?.params.results).toHaveLength(0);
		expect(call?.params.button?.text).toBe("Открыть бот и вставить ссылку");
	});

	test("invalid comment link → empty results + open-bot button", async () => {
		comment = textComment;
		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser({ first_name: "Tester" });

		await user.sendInlineQuery(
			"https://trashbox.ru/topics/132125#div_comment_",
		);

		const call = env.lastApiCall("answerInlineQuery");
		expect(call?.params.results).toHaveLength(0);
		expect(call?.params.button?.text).toBe("Открыть бот и вставить ссылку");
	});
});
