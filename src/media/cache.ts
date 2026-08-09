import type { MediaKind, MediaMetadata } from "../providers/types.ts";

export interface CachedMedia {
	kind: MediaKind;
	fileId: string;
	metadata: MediaMetadata;
}

const MAX_ENTRIES = 512;

const cache = new Map<string, CachedMedia>();

/** Maps a source URL to the file_id (and metadata) of media already sent from it. */
export const mediaCache = {
	get(url: string): CachedMedia | undefined {
		return cache.get(url);
	},
	set(url: string, value: CachedMedia): void {
		if (cache.size >= MAX_ENTRIES) {
			const oldest = cache.keys().next().value;
			if (oldest !== undefined) cache.delete(oldest);
		}
		cache.set(url, value);
	},
};
