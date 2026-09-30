import { rm } from "node:fs/promises";
import { join } from "node:path";
import { downloadTo } from "./http.ts";
import type { MediaAuthor, MediaItem, MediaKind } from "./types.ts";

/** Detects the file extension from a URL path, defaulting to `.jpg`. */
export function extensionOf(url: string): string {
	const pathname = new URL(url).pathname;
	const ext = pathname.split(".").at(-1)?.toLowerCase();
	return ext && /^[a-z0-9]+$/.test(ext) ? `.${ext}` : ".jpg";
}

/**
 * Builds an author object from partial info, or `undefined` when the author
 * has no display name. Keeps the profile URL only when it's meaningful.
 */
export function makeAuthor(parts: {
	displayName?: string;
	handle?: string;
	profileUrl?: string;
}): MediaAuthor | undefined {
	if (!parts.displayName) return undefined;
	return {
		displayName: parts.displayName,
		handle: parts.handle,
		profileUrl: parts.profileUrl,
	};
}

/** Unix seconds → ISO 8601 string. Providers normalize dates at the boundary. */
export function epochToIso(seconds: number): string {
	return new Date(seconds * 1000).toISOString();
}

const VIDEO_EXTENSION = /\.(mp4|webm|mov|mkv)$/i;

/** Infers the media kind from a local file path by its extension. */
export function kindFromPath(path: string): MediaKind {
	return VIDEO_EXTENSION.test(path) ? "video" : "photo";
}

/** A single remote file to download. `name` is the local file name without extension. */
export interface MediaSource {
	url: string;
	name: string;
	/** Forces the media kind instead of inferring it from the path. */
	kind?: MediaKind;
}

export interface DownloadMediaSourcesOptions {
	headers?: Record<string, string>;
	/** Downloads sources one by one instead of in parallel (pixiv throttles). */
	sequential?: boolean;
	/** Forces the media kind for every source (individual `kind` wins). */
	kind?: MediaKind;
}

/**
 * Turns a batch of remote URLs into `MediaSource`s, naming them
 * `<prefix>_<index>` — stable, sortable, and unique per post.
 */
export function mediaSources(
	prefix: string,
	urls: readonly string[],
	kind?: MediaKind,
): MediaSource[] {
	return urls.map((url, index) => ({
		url,
		name: `${prefix}_${index}`,
		...(kind ? { kind } : {}),
	}));
}

/**
 * Downloads every source into `dir`. On any failure the already-downloaded
 * files are removed and the error is rethrown.
 */
export async function downloadMediaSources(
	sources: MediaSource[],
	dir: string,
	options: DownloadMediaSourcesOptions = {},
): Promise<MediaItem[]> {
	const items: MediaItem[] = [];
	try {
		const download = async (source: MediaSource) => {
			// Videos are stored as MP4 regardless of the source extension.
			const outPath = join(
				dir,
				`${source.name}${source.kind === "video" ? ".mp4" : extensionOf(source.url)}`,
			);
			await downloadTo(
				source.url,
				outPath,
				options.headers ? { headers: options.headers } : undefined,
			);
			items.push({
				kind: source.kind ?? options.kind ?? kindFromPath(outPath),
				path: outPath,
			});
		};

		if (options.sequential) {
			for (const source of sources) await download(source);
		} else {
			await Promise.all(sources.map((source) => download(source)));
		}
	} catch (error) {
		await Promise.all(
			items.map((item) => rm(item.path, { force: true }).catch(() => {})),
		);
		throw error;
	}
	return items;
}
