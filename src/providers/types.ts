export type MediaKind = "photo" | "video";

export interface MediaItem {
	kind: MediaKind;
	/** Absolute or relative path to the downloaded file on disk */
	path: string;
}

export interface MediaAuthor {
	displayName: string;
	/** @handle for Twitter, numeric user id for Pixiv */
	handle?: string;
	/** Public profile URL — makes the author line clickable when present. */
	profileUrl?: string;
}

/** Platform-specific metadata for the source of the media. */
export interface MediaMetadata {
	/** Main text of the post — rendered as the expandable quote. */
	title?: string;
	author?: MediaAuthor;
	/** Where the post was published, e.g. `r/pics` for Reddit. */
	place?: string;
	date?: string;
	likes?: number;
	views?: number;
	bookmarks?: number;
	retweets?: number;
	replies?: number;
	tags?: string[];
}

export type StatKey = "likes" | "views" | "bookmarks" | "retweets" | "replies";

/** A single rendered caption line — `icon` is the leading emoji, empty means text-only. */
export interface CaptionLine {
	icon: string;
	text: string;
}

/** Presentation tweaks applied by the caption builder on top of `metadata`. */
export interface CaptionOptions {
	/** Order in which available stats are rendered (defaults to the shared default). */
	statsOrder?: readonly StatKey[];
	/** Provider-specific lines, rendered after the standard fields. */
	extra?: readonly CaptionLine[];
}

export interface ProviderResult {
	metadata: MediaMetadata;
	items: MediaItem[];
	caption?: CaptionOptions;
}

/** A media item addressable by a direct URL (used by inline mode). */
export interface DirectMediaItem {
	kind: MediaKind;
	/** Publicly fetchable URL Telegram can download itself. */
	url: string;
	/** Thumbnail URL — required for videos, optional for photos. */
	thumbnailUrl?: string;
}

export interface DirectMediaResult {
	metadata: MediaMetadata;
	items: DirectMediaItem[];
	caption?: CaptionOptions;
}

export interface Provider {
	name: string;
	/** Human-readable site names this provider handles (e.g. "X (Twitter)"). */
	sites: string[];
	match(url: URL): boolean;
	fetch(url: URL, downloadDir: string): Promise<ProviderResult>;
	/**
	 * Fast resolution of directly-embeddable media URLs for inline mode.
	 * Must not download anything — inline queries are answered within seconds.
	 * Omit it for providers whose media can't be referenced by a public URL.
	 */
	resolveDirect?(url: URL): Promise<DirectMediaResult>;
}
