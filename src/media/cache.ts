import type {
	CaptionOptions,
	MediaKind,
	MediaMetadata,
} from "../providers/types.ts";
import { createBoundedStore } from "../services/bounded-store.ts";

export interface CachedMedia {
	kind: MediaKind;
	fileId: string;
	metadata: MediaMetadata;
	/** Presentation tweaks, kept so cached hits render the same caption. */
	caption?: CaptionOptions;
}

const MAX_ENTRIES = 512;

const store = createBoundedStore<CachedMedia>(MAX_ENTRIES);

/** Maps a source URL to the file_id (and metadata) of media already sent from it. */
export const mediaCache = {
	get(url: string): CachedMedia | undefined {
		return store.get(url);
	},
	set(url: string, value: CachedMedia): void {
		store.set(url, value);
	},
};
