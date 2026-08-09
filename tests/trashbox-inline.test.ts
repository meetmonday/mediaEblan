import "./setup.ts";
import { describe, expect, mock, test } from "bun:test";
import { join } from "node:path";
import { TelegramTestEnvironment } from "@gramio/test";
import { bot } from "../src/bot.ts";

const servicePath = join(import.meta.dir, "../src/services/trashbox.ts");

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
		"Помню<br/><img src='/files/2554043_184a9c/1000341956.webp.png' data-trash-lightbox2='256;256;/files/2554043_184a9c/1000341956.webp.png;-thumb.jpg 90 90,-orig.jpg 256 256'/>",
};

class MockTrashboxError extends Error {}

let comment: typeof textComment | null = textComment;
let parseError: Error | null = null;

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
		return { topicId: 132125, commentId: 1288345, host: "trashbox.ru" };
	},
	fetchComment: async () => comment,
	commentMediaSources: () => [],
	firstImgSrc: () => null,
	buildCommentMessage: (_c, url, includeImages = true) =>
		includeImages && _c.content.includes("<img")
			? `👤 ${_c.login}\n\nПомню\n\n🖼 https://trashbox.ru/files/2554043_184a9c/1000341956.webp.png\n\n🔗 ${url}`
			: `👤 ${_c.login} — ${url}`,
}));

describe("flow: inline trashbox comments", () => {
	test("comment with a photo → article with the image embedded as a text link", async () => {
		comment = photoComment;
		const env = new TelegramTestEnvironment(bot);
		const user = env.createUser({ first_name: "Tester" });

		await user.sendInlineQuery(
			"https://trashbox.ru/link/oduvanchik-android#div_comment_1435158",
		);

		const call = env.lastApiCall("answerInlineQuery");
		expect(call).toBeDefined();
		expect(call?.params.results).toHaveLength(1);
		// @ts-expect-error -- result is a discriminated union
		expect(call?.params.results[0]?.type).toBe("article");
		// @ts-expect-error -- result is a discriminated union
		expect(call?.params.results[0]?.input_message_content?.message_text).toContain(
			"kekos",
		);
		// @ts-expect-error -- result is a discriminated union
		expect(call?.params.results[0]?.input_message_content?.message_text).toContain(
			"https://trashbox.ru/files/2554043_184a9c/1000341956.webp.png",
		);
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
		parseError = new MockTrashboxError("Некорректная ссылка");
		try {
			const env = new TelegramTestEnvironment(bot);
			const user = env.createUser({ first_name: "Tester" });

			await user.sendInlineQuery(
				"https://trashbox.ru/topics/132125#div_comment_",
			);

			const call = env.lastApiCall("answerInlineQuery");
			expect(call?.params.results).toHaveLength(0);
			expect(call?.params.button?.text).toBe("Открыть бот и вставить ссылку");
		} finally {
			parseError = null;
		}
	});
});
