import type { MediaMetadata } from "../providers/types.ts";

function formatCount(value: number): string {
	const format = (scaled: number, suffix: string) =>
		`${scaled.toFixed(1).replace(".", ",").replace(",0", "")}${suffix}`;
	if (value >= 1_000_000) return format(value / 1_000_000, "M");
	if (value >= 1_000) return format(value / 1_000, "K");
	return String(value);
}

function formatDate(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "";
	const day = String(date.getDate()).padStart(2, "0");
	const month = String(date.getMonth() + 1).padStart(2, "0");
	return `${day}.${month}.${date.getFullYear()}`;
}

/** Builds a plain-text caption for media sent from the given metadata. */
export function buildCaption(
	metadata: MediaMetadata,
	sourceUrl?: string,
): string {
	const lines: string[] = [];

	if (metadata.title) lines.push(`📌 ${metadata.title}`);
	if (metadata.author) {
		const author = metadata.author.handle
			? `${metadata.author.displayName} (@${metadata.author.handle})`
			: metadata.author.displayName;
		lines.push(`👤 ${author}`);
	}

	const stats: string[] = [];
	if (metadata.likes !== undefined)
		stats.push(`❤️ ${formatCount(metadata.likes)}`);
	if (metadata.retweets !== undefined)
		stats.push(`🔁 ${formatCount(metadata.retweets)}`);
	if (metadata.replies !== undefined)
		stats.push(`💬 ${formatCount(metadata.replies)}`);
	if (metadata.views !== undefined)
		stats.push(`👁 ${formatCount(metadata.views)}`);
	if (metadata.bookmarks !== undefined)
		stats.push(`🔖 ${formatCount(metadata.bookmarks)}`);
	if (stats.length > 0) lines.push(stats.join("  "));

	if (metadata.date) {
		const date = formatDate(metadata.date);
		if (date) lines.push(`🗓 ${date}`);
	}

	if (metadata.tags && metadata.tags.length > 0) {
		lines.push(
			metadata.tags
				.slice(0, 10)
				.map((tag) => `#${tag}`)
				.join(" "),
		);
	}

	if (sourceUrl) lines.push(`\n🔗 ${sourceUrl}`);

	return lines.join("\n");
}
