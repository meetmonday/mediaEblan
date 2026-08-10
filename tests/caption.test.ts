import { describe, expect, test } from "bun:test";
import { CaptionBuilder, captionFor } from "../src/media/caption.ts";
import type { MediaMetadata } from "../src/providers/types.ts";

const author = {
	displayName: "ArtLover",
	handle: "art_lover",
	profileUrl: "https://x.com/art_lover",
};

const metadata: MediaMetadata = {
	title: "Солнечный день",
	author,
	likes: 1_234_567,
	retweets: 1_200,
	replies: 42,
	views: 9_876_543,
	bookmarks: 88_000,
	tags: ["солнце", "пейзаж"],
};

const statsLine = "❤️ 1,2M  🔁 1,2K  💬 42  👁 9,9M  🔖 88K";

describe("captionFor: standard layout", () => {
	test("renders author, text, tags, blank line, stats — in this order", () => {
		const caption = captionFor(metadata).build();
		expect(caption.toString()).toBe(
			`👤 ArtLover (@art_lover)\nСолнечный день\n#солнце #пейзаж\n\n${statsLine}`,
		);
	});

	test("author line is a profile link and main text is an expandable quote", () => {
		const caption = captionFor(metadata).build();
		expect(caption.entities).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "text_link",
					url: "https://x.com/art_lover",
				}),
				expect.objectContaining({ type: "expandable_blockquote" }),
			]),
		);
	});

	test("place of publication is appended after the author", () => {
		const caption = captionFor({
			author,
			place: "r/pics",
			title: "Т",
		}).build();
		expect(caption.toString()).toBe("👤 ArtLover (@art_lover) - r/pics\nТ\n");
		expect(caption.entities).toEqual(
			expect.arrayContaining([expect.objectContaining({ type: "text_link" })]),
		);
	});

	test("author without a handle renders the display name only", () => {
		expect(
			captionFor({ author: { displayName: "Kekos" }, title: "Т" })
				.build()
				.toString(),
		).toBe("👤 Kekos\nТ\n");
	});

	test("skips absent fields and renders empty for empty metadata", () => {
		expect(captionFor({}).build().toString()).toBe("");
	});

	test("no blank line when there is no text content", () => {
		expect(captionFor({ author, likes: 5 }).build().toString()).toBe(
			"👤 ArtLover (@art_lover)\n❤️ 5",
		);
	});
});

describe("captionFor: provider tweaks", () => {
	test("statsOrder overrides the rendering order", () => {
		const caption = captionFor(metadata, {
			statsOrder: ["views", "likes", "bookmarks", "replies"],
		}).build();
		expect(caption.toString()).toBe(
			`👤 ArtLover (@art_lover)\nСолнечный день\n#солнце #пейзаж\n\n👁 9,9M  ❤️ 1,2M  🔖 88K  💬 42`,
		);
	});

	test("statsOrder renders only the present stats", () => {
		expect(
			captionFor({ likes: 5, views: 7 }, { statsOrder: ["views", "likes"] })
				.build()
				.toString(),
		).toBe("👁 7  ❤️ 5");
	});

	test("extra lines are appended after the metadata block", () => {
		const caption = captionFor(metadata, {
			extra: [{ icon: "🎬", text: "1080p" }],
		}).build();
		expect(caption.toString()).toBe(
			`👤 ArtLover (@art_lover)\nСолнечный день\n#солнце #пейзаж\n\n${statsLine}\n🎬 1080p`,
		);
	});

	test("extra line without an icon renders text-only", () => {
		const caption = captionFor(metadata, {
			extra: [{ icon: "", text: "R-18" }],
		}).build();
		expect(caption.toString()).toContain("\nR-18");
	});
});

describe("captionFor: source link", () => {
	test("appended after a blank line as a clickable link", () => {
		const caption = captionFor({ title: "Т" })
			.sourceLink("https://example.com/post")
			.build();
		expect(caption.toString()).toBe("Т\n\n🔗 https://example.com/post");
		expect(caption.entities).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "text_link",
					url: "https://example.com/post",
				}),
			]),
		);
	});

	test("missing link adds nothing", () => {
		expect(
			captionFor({ title: "Т" }).sourceLink(undefined).build().toString(),
		).toBe("Т\n");
	});
});

describe("captionFor: date", () => {
	const now = new Date("2026-08-11T12:00:00Z");

	function dateText(value: string): string {
		return new CaptionBuilder().date(value, now).build().toString();
	}

	test("same year omits the year, shows UTC time and relative age", () => {
		expect(dateText("2026-08-01T03:00:00Z")).toBe(
			"🗓 01.08 03:00 (10 д. назад)",
		);
	});

	test("different year appends the year", () => {
		expect(dateText("2025-12-31T23:00:00Z")).toBe("🗓 31.12.25 23:00");
	});

	test("relative age uses hours and minutes", () => {
		expect(dateText("2026-08-11T10:00:00Z")).toBe("🗓 11.08 10:00 (2 ч. назад)");
		expect(dateText("2026-08-11T11:30:00Z")).toBe(
			"🗓 11.08 11:30 (30 мин. назад)",
		);
		expect(dateText("2026-08-11T11:59:30Z")).toBe("🗓 11.08 11:59 (только что)");
	});

	test("invalid date renders nothing", () => {
		expect(new CaptionBuilder().date("не дата", now).build().toString()).toBe(
			"",
		);
	});
});

describe("CaptionBuilder: manual assembly", () => {
	test("chains methods in call order", () => {
		const caption = new CaptionBuilder()
			.author(author, "r/pics")
			.text("Ролик про кота")
			.tags(["кот", "ролик"], 10)
			.separator()
			.stats({ likes: 12_345, views: 678_901 })
			.date("2026-08-01T12:00:00+09:00", new Date("2026-08-11T12:00:00Z"))
			.sourceLink("https://example.com/video")
			.build();
		expect(caption.toString()).toBe(`👤 ArtLover (@art_lover) - r/pics
Ролик про кота
#кот #ролик

❤️ 12,3K  👁 678,9K
🗓 01.08 03:00 (10 д. назад)

🔗 https://example.com/video`);
	});

	test("tags are capped at the max argument", () => {
		const tags = Array.from({ length: 15 }, (_, index) => `tag${index}`);
		expect(new CaptionBuilder().tags(tags, 5).build().toString()).toBe(
			"#tag0 #tag1 #tag2 #tag3 #tag4",
		);
	});
});
