import type { TelegramInlineQueryResult } from "@gramio/types";
import { Composer, InlineQueryResult } from "gramio";
import { mediaCache } from "../media/cache.ts";
import { buildCaption } from "../media/caption.ts";
import { composer } from "../plugins/index.ts";
import { findMediaUrl, resolveProvider } from "../providers/registry.ts";
import type { DirectMediaResult } from "../providers/types.ts";

const ANSWER_OPTIONS = { cache_time: 0, is_personal: true } as const;

const OPEN_BOT_BUTTON = {
	text: "Открыть бот и вставить ссылку",
	start_parameter: "inline",
};

function toInlineResults(
	{ metadata, items }: DirectMediaResult,
	sourceUrl: string,
): TelegramInlineQueryResult[] {
	const caption = buildCaption(metadata, sourceUrl);
	const results: TelegramInlineQueryResult[] = [];
	for (const [index, item] of items.entries()) {
		if (item.kind === "photo") {
			results.push(
				InlineQueryResult.photo(
					String(index),
					item.url,
					item.thumbnailUrl ?? item.url,
					{
						caption,
						title: `Фото ${index + 1}`,
					},
				),
			);
		} else if (item.thumbnailUrl) {
			results.push(
				InlineQueryResult.videoMp4(
					String(index),
					`Видео ${index + 1}`,
					item.url,
					item.thumbnailUrl,
					{
						caption,
					},
				),
			);
		}
	}
	return results;
}

export const inlineComposer = new Composer()
	.extend(composer)
	.inlineQuery(/https?:\/\/\S+/i, async (context) => {
		const url = findMediaUrl(context.query);
		if (!url) return context.answer([], ANSWER_OPTIONS);

		try {
			const cached = mediaCache.get(url.toString());
			if (cached) {
				const caption = buildCaption(cached.metadata, url.toString());
				const result =
					cached.kind === "photo"
						? InlineQueryResult.cached.photo("0", cached.fileId, { caption })
						: InlineQueryResult.cached.video(
								"0",
								cached.metadata.title ?? "Видео",
								cached.fileId,
								{
									caption,
								},
							);
				return context.answer([result], ANSWER_OPTIONS);
			}

			const direct = await resolveProvider(url)?.resolveDirect?.(url);
			if (direct && direct.items.length > 0) {
				return context.answer(
					toInlineResults(direct, url.toString()),
					ANSWER_OPTIONS,
				);
			}
		} catch {
			// Resolution failed — offer the chat as a fallback.
		}

		return context.answer([], { ...ANSWER_OPTIONS, button: OPEN_BOT_BUTTON });
	});
