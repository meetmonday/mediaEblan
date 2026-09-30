import { ProviderError } from "../errors.ts";
import { downloadMediaSources, mediaSources } from "../helpers.ts";
import type { DirectMediaResult, Provider, ProviderResult } from "../types.ts";
import { directImageItems, imageSources } from "./media.ts";
import {
	fetchPost,
	isSupportedUrl,
	metadataOf,
	NAME,
	NO_MEDIA,
	redditVideo,
} from "./post.ts";
import { downloadVideo } from "./video.ts";

export { extractPostId, parse } from "./post.ts";

export const redditProvider: Provider = {
	name: NAME,
	sites: ["Reddit"],
	match: isSupportedUrl,
	async fetch(url, downloadDir): Promise<ProviderResult> {
		const { id, post } = await fetchPost(url);
		const metadata = metadataOf(post);

		if (redditVideo(post)) {
			return { metadata, items: [await downloadVideo(post, id, downloadDir)] };
		}

		const sources = imageSources(post);
		if (sources.length === 0) throw new ProviderError(NAME, NO_MEDIA);

		return {
			metadata,
			items: await downloadMediaSources(mediaSources(id, sources), downloadDir),
		};
	},
	async resolveDirect(url): Promise<DirectMediaResult> {
		const { post } = await fetchPost(url);
		const metadata = metadataOf(post);

		// DASH video files carry no audio track — direct inline won't work.
		if (redditVideo(post)) return { metadata, items: [] };

		return { metadata, items: directImageItems(post) };
	},
};
