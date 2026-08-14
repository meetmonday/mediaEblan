import type { TrashboxComment } from "../services/trashbox.ts";
import {
	commentBody,
	commentMediaSources,
	commentMessage,
	commentMetadata,
	fetchComment,
	firstImgSrc,
	isCommentUrl,
	resolveCommentUrl,
} from "../services/trashbox.ts";
import { ProviderError } from "./errors.ts";
import { downloadMediaSources } from "./helpers.ts";
import type { Provider, ProviderResult } from "./types.ts";

async function fetchCommentOrThrow(url: URL): Promise<TrashboxComment> {
	const { topicId, commentId, host } = await resolveCommentUrl(url);
	const comment = await fetchComment(topicId, commentId, host);
	if (!comment) throw new ProviderError("trashbox", "Комментарий не найден");
	return comment;
}

export const trashboxProvider: Provider = {
	name: "trashbox",
	sites: ["Trashbox"],
	match: (url) => isCommentUrl(url),
	async fetch(url, downloadDir): Promise<ProviderResult> {
		const comment = await fetchCommentOrThrow(url);
		const sourceUrl = url.toString();
		const mediaUrls = commentMediaSources(comment.content);
		const metadata = commentMetadata(comment);

		if (mediaUrls.length === 0) {
			return {
				metadata,
				items: [],
				text: {
					content: commentMessage(comment, sourceUrl, true, false),
					disableLinkPreview: firstImgSrc(comment.content) === null,
					sourceUrl,
				},
			};
		}

		const items = await downloadMediaSources(
			mediaUrls.map((mediaUrl, index) => ({
				url: mediaUrl,
				name: `trashbox-${comment.comm_id}-${index}`,
			})),
			downloadDir,
		);

		return {
			metadata,
			items,
			caption: {
				content: commentBody(comment, false),
				sourceLink: sourceUrl,
			},
		};
	},
};
