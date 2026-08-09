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
}

/** Platform-specific metadata for the source of the media. */
export interface MediaMetadata {
	title?: string;
	author?: MediaAuthor;
	date?: string;
	likes?: number;
	views?: number;
	bookmarks?: number;
	retweets?: number;
	replies?: number;
	tags?: string[];
}

export interface ProviderResult {
	metadata: MediaMetadata;
	items: MediaItem[];
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
