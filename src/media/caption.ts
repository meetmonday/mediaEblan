import {
	expandableBlockquote,
	type FormattableString,
	format,
	join,
	link,
} from "gramio";
import type {
	CaptionLine,
	CaptionOptions,
	MediaAuthor,
	MediaMetadata,
	ProviderResult,
	StatKey,
} from "../providers/types.ts";

/** Emoji prefix per stat type. */
export const STAT_ICONS: Record<StatKey, string> = {
	likes: "❤️",
	views: "👁",
	bookmarks: "🔖",
	retweets: "🔁",
	replies: "💬",
};

/** Default stat order, shared by every provider that doesn't override it. */
export const DEFAULT_STAT_ORDER: readonly StatKey[] = [
	"likes",
	"retweets",
	"replies",
	"views",
	"bookmarks",
];

function formatCount(value: number): string {
	const format = (scaled: number, suffix: string) =>
		`${scaled.toFixed(1).replace(".", ",").replace(",0", "")}${suffix}`;
	if (value >= 1_000_000) return format(value / 1_000_000, "M");
	if (value >= 1_000) return format(value / 1_000, "K");
	return String(value);
}

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** "2 ч. назад" / "3 д. назад" — null once older than 14 days. */
function relativeAge(ageMs: number): string | null {
	if (ageMs < 0) return null;
	if (ageMs < MINUTE) return "только что";
	if (ageMs < HOUR) return `${Math.floor(ageMs / MINUTE)} мин. назад`;
	if (ageMs < DAY) return `${Math.floor(ageMs / HOUR)} ч. назад`;
	if (ageMs <= 14 * DAY) return `${Math.floor(ageMs / DAY)} д. назад`;
	return null;
}

/** `DD.MM[.YY] HH:MM (относительно)` — year shown only when it differs. */
function formatDate(value: string, now = new Date()): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "";

	const pad = (n: number) => String(n).padStart(2, "0");
	const day = pad(date.getUTCDate());
	const month = pad(date.getUTCMonth() + 1);
	const time = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
	const datePart =
		date.getUTCFullYear() === now.getUTCFullYear()
			? `${day}.${month}`
			: `${day}.${month}.${pad(date.getUTCFullYear() % 100)}`;
	const relative = relativeAge(now.getTime() - date.getTime());

	return relative ? `${datePart} ${time} (${relative})` : `${datePart} ${time}`;
}

/**
 * Assembles a media caption line by line. Start from `captionFor` to get the
 * standard layout, then append provider-specific lines as needed.
 */
export class CaptionBuilder {
	private readonly lines: Array<string | FormattableString> = [];
	private hasContent = false;

	/**
	 * Author line with an optional place of publication:
	 * `👤 Name (@handle) - r/subreddit`. The name becomes a profile link
	 * when `profileUrl` is present.
	 */
	author(author?: MediaAuthor, place?: string): this {
		if (!author) return this;
		const handle = author.handle
			? author.displayName
				? ` (@${author.handle})`
				: `@${author.handle}`
			: "";
		const name = `${author.displayName}${handle}`;
		const authorLine = author.profileUrl
			? link(`👤 ${name}`, author.profileUrl)
			: `👤 ${name}`;
		this.lines.push(place ? format`${authorLine} - ${place}` : authorLine);
		return this;
	}

	/** Main post text, wrapped in a collapsible quote. */
	text(value?: string): this {
		if (value) {
			this.lines.push(expandableBlockquote(value));
			this.hasContent = true;
		}
		return this;
	}

	/** Rich formatted body — replaces the plain `text` quote when provided. */
	content(value?: FormattableString): this {
		if (value) {
			this.lines.push(value);
			this.hasContent = true;
		}
		return this;
	}

	/** Separate hashtags. Providers whose tags are already in the text skip this. */
	tags(values?: string[], max = 10): this {
		if (!values || values.length === 0) return this;
		this.lines.push(
			values
				.slice(0, max)
				.map((tag) => `#${tag}`)
				.join(" "),
		);
		this.hasContent = true;
		return this;
	}

	/** Blank line separating the content block from the metadata block. */
	separator(): this {
		if (this.hasContent && this.lines.at(-1) !== "") this.lines.push("");
		return this;
	}

	/** Renders all present stats as one line, in the given (or default) order. */
	stats(
		metadata: Pick<MediaMetadata, StatKey>,
		order: readonly StatKey[] = DEFAULT_STAT_ORDER,
	): this {
		const values: string[] = [];
		for (const key of order) {
			const value = metadata[key];
			if (value !== undefined)
				values.push(`${STAT_ICONS[key]} ${formatCount(value)}`);
		}
		if (values.length > 0) this.lines.push(values.join("  "));
		return this;
	}

	/** `🗓 DD.MM[.YY] HH:MM (относительно)` in UTC. */
	date(value?: string, now?: Date): this {
		if (!value) return this;
		const formatted = formatDate(value, now);
		if (formatted) this.lines.push(`🗓 ${formatted}`);
		return this;
	}

	/** Appends arbitrary lines, rendered as `icon text` (text-only when icon is empty). */
	extra(...lines: CaptionLine[]): this {
		for (const line of lines) {
			if (line.text)
				this.lines.push(line.icon ? `${line.icon} ${line.text}` : line.text);
		}
		return this;
	}

	/** Appends the source link as a clickable line, separated by a blank line. */
	sourceLink(url?: string): this {
		if (!url) return this;
		if (this.lines.length > 0 && this.lines.at(-1) !== "") this.lines.push("");
		this.lines.push(link(`🔗 ${url}`, url));
		return this;
	}

	build(): FormattableString {
		return join(this.lines, "\n");
	}
}

/**
 * What a single caption render needs: the provider's presentation tweaks plus
 * the caller's own decisions about the source link.
 */
export interface CaptionParams {
	/** Provider-supplied tweaks (stat order, extra lines, rich body, link). */
	options?: CaptionOptions;
	/** Source link used when the provider didn't set `options.sourceLink`. */
	sourceUrl?: string;
	/**
	 * Drops the `🔗 url` line entirely — used when the source is exposed as
	 * «Открыть»/«Поделиться» buttons instead of caption text (deep-link and
	 * inline flows).
	 */
	includeSourceLink?: boolean;
}

/**
 * Builds the standard media caption from metadata:
 * author (+place), main text as a quote (or rich `content` when provided),
 * tags, then stats and date.
 * Provider-specific tweaks (stat order, extra lines, content, source link)
 * come from `params.options`; `params.sourceUrl` is the fallback for the source
 * link when the provider didn't set one explicitly.
 */
export function captionFor(
	metadata: MediaMetadata,
	params: CaptionParams = {},
): CaptionBuilder {
	const { options, sourceUrl, includeSourceLink = true } = params;
	const builder = new CaptionBuilder()
		.author(metadata.author, metadata.place)
		.text(options?.content ? undefined : metadata.title)
		.content(options?.content)
		.tags(metadata.tags)
		.separator()
		.stats(metadata, options?.statsOrder)
		.date(metadata.date)
		.extra(...(options?.extra ?? []));
	return includeSourceLink
		? builder.sourceLink(options?.sourceLink ?? sourceUrl)
		: builder;
}

/** Rebuilds the caption of a cached hit from its stored metadata and options. */
export function cachedCaption(
	entry: { metadata: MediaMetadata; caption?: CaptionOptions },
	params: Omit<CaptionParams, "options"> = {},
): FormattableString {
	return captionFor(entry.metadata, {
		...params,
		options: entry.caption,
	}).build();
}

/**
 * Renders a text-only provider result (a comment without media): the standard
 * metadata block with the comment body as its content, then the source link.
 * With `includeSourceLink = false` the link is left to the attached buttons.
 */
export function textResultCaption(
	result: ProviderResult,
	params: CaptionParams = {},
): FormattableString {
	return captionFor(result.metadata, {
		...params,
		options: { ...params.options, content: result.text?.content },
		sourceUrl: params.sourceUrl ?? result.text?.sourceUrl,
	}).build();
}
