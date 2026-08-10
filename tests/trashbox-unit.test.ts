import { describe, expect, test } from "bun:test";
import {
	commentMessage,
	findCommentUrl,
	resolveCommentUrl,
} from "../src/services/trashbox.ts";

describe("trashbox comment URL parsing", () => {
	test("extracts the full URL including the comment id", () => {
		const url = findCommentUrl(
			"https://trashbox.ru/topics/214225/nodavlat-bogcha-0.0.20#div_comment_1435291",
		);
		expect(url?.href).toBe(
			"https://trashbox.ru/topics/214225/nodavlat-bogcha-0.0.20#div_comment_1435291",
		);
	});

	test("extracts the URL from surrounding text and trailing punctuation", () => {
		const url = findCommentUrl(
			"смотри https://trashbox.ru/topics/214225#div_comment_1435291. плиз",
		);
		expect(url?.hash).toBe("#div_comment_1435291");
		expect(url?.pathname).toBe("/topics/214225");
	});

	test("returns null without a comment anchor", () => {
		expect(findCommentUrl("https://trashbox.ru/topics/214225")).toBeNull();
		expect(findCommentUrl("просто текст")).toBeNull();
	});

	test("parses topic and comment ids", async () => {
		const url = findCommentUrl(
			"https://trashbox.ru/topics/214225/slug#div_comment_1435291",
		);
		if (!url) throw new Error("expected a comment URL");
		expect(await resolveCommentUrl(url)).toEqual({
			topicId: 214225,
			commentId: 1435291,
			host: "trashbox.ru",
		});
	});

	test("rejects a comment anchor without an id", async () => {
		const url = findCommentUrl(
			"https://trashbox.ru/topics/214225#div_comment_",
		);
		if (!url) throw new Error("expected a comment URL");
		await expect(resolveCommentUrl(url)).rejects.toThrow("Некорректная ссылка");
	});

	test("rejects non-trashbox hosts", async () => {
		const url = findCommentUrl(
			"https://zalupa.ru/topics/214225#div_comment_1435291",
		);
		if (!url) throw new Error("expected a comment URL");
		await expect(resolveCommentUrl(url)).rejects.toThrow("Некорректная ссылка");
	});
});

describe("trashbox comment message", () => {
	const comment = {
		comm_id: "1334063",
		parent: "0",
		content:
			'<div class="center"><img src="/files/1571085_593c29/frame_1.png_min.jpg" data-trash-lightbox2="554;938;/files/1571085_593c29/frame_1.png;-max1.jpg 472 800,-thumb.jpg 53 90,-orig.jpg 554 938,_minx2.jpg 472 800,_min.jpg 236 400" width="236" height="400"/> </div>',
		login: "kekos",
		avatar: "1939444_fe7997_big",
		posted: "1619534421",
		votes: "0",
	};
	const sourceUrl = "https://trashbox.ru/topics/132125/mm#div_comment_1334063";

	test("embeds comment images as clickable text links with the URL as label", () => {
		const message = commentMessage(comment, sourceUrl);
		const text = message.toString();
		expect(text).toContain("🖼");
		expect(text).toContain(
			"https://trashbox.ru/files/1571085_593c29/frame_1.png_min.jpg",
		);
		expect(text).toContain(sourceUrl);
		expect(message.entities).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "text_link",
					url: "https://trashbox.ru/files/1571085_593c29/frame_1.png_min.jpg",
				}),
			]),
		);
	});
});
