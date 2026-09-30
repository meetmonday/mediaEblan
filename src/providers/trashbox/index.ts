import { ProviderError } from "../errors.ts";
import { downloadMediaSources, mediaSources } from "../helpers.ts";
import type { Provider, ProviderResult } from "../types.ts";
import {
	commentBody,
	commentMediaSources,
	commentMetadata,
	fetchComment,
	firstImgSrc,
	isCommentUrl,
	resolveCommentUrl,
	type TrashboxComment,
} from "./comment.ts";

/** Resolves a comment URL and fetches the comment, or throws a semantic error. */
export async function resolveComment(url: URL): Promise<TrashboxComment> {
	const { topicId, commentId, host } = await resolveCommentUrl(url);
	const comment = await fetchComment(topicId, commentId, host);
	if (!comment) throw new ProviderError("trashbox", "Комментарий не найден");
	return comment;
}

/**
 * A comment as a text-only result — no media to download, the body is the
 * message. Chat mode renders it as a plain message, inline mode as an article.
 * `disableLinkPreview` matters only for the chat branch: a comment whose first
 * image is the preview keeps Telegram's preview, otherwise it's turned off.
 */
export function commentResult(
	comment: TrashboxComment,
	sourceUrl: string,
	disableLinkPreview?: boolean,
): ProviderResult {
	return {
		metadata: commentMetadata(comment),
		items: [],
		text: {
			content: commentBody(comment),
			disableLinkPreview,
			sourceUrl,
			title: `Комментарий @${comment.login}`,
		},
	};
}

export const trashboxProvider: Provider = {
	name: "trashbox",
	sites: ["Trashbox"],
	match: (url) => isCommentUrl(url),
	async fetch(url, downloadDir): Promise<ProviderResult> {
		const comment = await resolveComment(url);
		const sourceUrl = url.toString();
		const mediaUrls = commentMediaSources(comment.content);

		// No embedded images — the comment itself is the whole answer.
		if (mediaUrls.length === 0) {
			return commentResult(
				comment,
				sourceUrl,
				firstImgSrc(comment.content) === null,
			);
		}

		const items = await downloadMediaSources(
			mediaSources(`trashbox-${comment.comm_id}`, mediaUrls),
			downloadDir,
		);

		return {
			metadata: commentMetadata(comment),
			items,
			caption: {
				content: commentBody(comment, false),
				sourceLink: sourceUrl,
			},
		};
	},
};
