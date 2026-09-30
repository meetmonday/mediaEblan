import type { DirectMediaItem } from "../types.ts";
import type { RedditPost } from "./post.ts";

const MIME_EXT: Record<string, string> = {
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/gif": "gif",
	"image/webp": "webp",
};

function decodeEntities(value: string): string {
	return value.replaceAll("&amp;", "&");
}

function isImageUrl(value: string | undefined): boolean {
	return (
		value !== undefined && /\.(jpe?g|png|gif|webp|avif)(\?|$)/i.test(value)
	);
}

function galleryImageUrls(post: RedditPost): string[] {
	const urls: string[] = [];
	for (const item of post.gallery_data?.items ?? []) {
		if (!item.media_id) continue;
		const meta = post.media_metadata?.[item.media_id];
		if (meta?.status !== "valid") continue;
		if (meta.s?.u) {
			urls.push(decodeEntities(meta.s.u));
			continue;
		}
		// Some gallery entries carry no preview URL — rebuild the direct one.
		const ext = MIME_EXT[meta.m ?? ""];
		if (ext) urls.push(`https://i.redd.it/${item.media_id}.${ext}`);
	}
	return urls;
}

function singleImageUrl(post: RedditPost): string | null {
	if (isImageUrl(post.url)) return post.url ?? null;
	const source = post.preview?.images?.[0]?.source?.url;
	return source && isImageUrl(source) ? decodeEntities(source) : null;
}

/** Every image URL of a post — a gallery, a single image, or none at all. */
export function imageSources(post: RedditPost): string[] {
	if (post.is_gallery) return galleryImageUrls(post);
	const single = singleImageUrl(post);
	return single ? [single] : [];
}

/** The same images as inline-ready items — i.redd.it / preview.redd.it URLs. */
export function directImageItems(post: RedditPost): DirectMediaItem[] {
	return imageSources(post).map((url) => ({ kind: "photo" as const, url }));
}
