import { describe, expect, test } from "bun:test";
import { textResultCaption } from "../src/media/caption.ts";
import {
	commentMediaSources,
	findCommentUrl,
	firstImgSrc,
	htmlCleaner,
	resolveCommentUrl,
} from "../src/providers/trashbox/comment.ts";
import { commentResult } from "../src/providers/trashbox/index.ts";

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

describe("trashbox html cleaner", () => {
	test("strips disallowed tags but keeps their content", () => {
		const cleaned = htmlCleaner(
			'<div class="center">текст<br/><script>alert(1)</script></div>',
		);
		expect(cleaned).toContain("текст");
		expect(cleaned).toContain("alert(1)");
		expect(cleaned).not.toContain("<div");
		expect(cleaned).not.toContain("<script");
	});

	test("keeps allowed formatting tags", () => {
		const cleaned = htmlCleaner("<strong>Жирный</strong> <i>курсив</i>");
		expect(cleaned).toContain("**Жирный**");
		expect(cleaned).toContain("_курсив_");
	});

	test("with stripImages the images are removed entirely", () => {
		const cleaned = htmlCleaner(
			'Скрин<br/><img src="/files/2555000_be982b/1001288496.jpg_min.jpg"/>',
			true,
		);
		expect(cleaned).not.toContain("files/");
		expect(cleaned).not.toContain("🖼");
	});

	test("without stripImages images become clickable absolute links", () => {
		const cleaned = htmlCleaner(
			'<img src="/files/2555000_be982b/1001288496.jpg_min.jpg"/>',
		);
		expect(cleaned).toContain(
			"https://trashbox.ru/files/2555000_be982b/1001288496.jpg_min.jpg",
		);
		expect(cleaned).toContain("🖼");
	});
});

describe("trashbox image helpers", () => {
	test("firstImgSrc makes relative /files/ paths absolute", () => {
		expect(
			firstImgSrc('<img src="/files/2555000_be982b/1001288496.jpg_min.jpg"/>'),
		).toBe("https://trashbox.ru/files/2555000_be982b/1001288496.jpg_min.jpg");
	});

	test("firstImgSrc returns external URLs as-is and null without images", () => {
		expect(firstImgSrc('<img src="https://ex.com/a.jpg">')).toBe(
			"https://ex.com/a.jpg",
		);
		expect(firstImgSrc("просто текст")).toBeNull();
	});

	test("commentMediaSources prefers the full-size lightbox URL", () => {
		const urls = commentMediaSources(
			'<img src="/files/2555000_be982b/1001288496.jpg_min.jpg" data-trash-lightbox2="1600;2560;/files/2555000_be982b/1001288496.jpg;"/>',
		);
		expect(urls).toEqual([
			"https://trashbox.ru/files/2555000_be982b/1001288496.jpg",
		]);
	});

	test("commentMediaSources collects every image and skips src-less tags", () => {
		const urls = commentMediaSources(
			'<img src="/files/a_min.jpg"/><img/><img src="https://ex.com/b.jpg"/><img src="/files/c.jpg" data-trash-lightbox2="1;2;/files/c_orig.jpg;"/>',
		);
		expect(urls).toEqual([
			"https://trashbox.ru/files/a_min.jpg",
			"https://ex.com/b.jpg",
			"https://trashbox.ru/files/c_orig.jpg",
		]);
	});
});

describe("trashbox comment result", () => {
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
		const message = textResultCaption(commentResult(comment, sourceUrl));
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

	test("carries metadata and a title, no media items", () => {
		const result = commentResult(comment, sourceUrl);
		expect(result.items).toHaveLength(0);
		expect(result.metadata.author?.displayName).toBe("kekos");
		expect(result.text?.title).toBe("Комментарий @kekos");
	});
});
