import { Composer } from "gramio";
import { resolveQuery } from "../media/query.ts";
import { composer } from "../plugins/index.ts";
import { pendingLinks } from "../services/pending-links.ts";

const ANSWER_OPTIONS = { cache_time: 0, is_personal: true } as const;

/**
 * Fallback button for links inline mode can't serve directly. The URL is
 * stored under a short token; pressing the button opens the bot PM and
 * sends `/start <token>`, which the start handler exchanges for the URL.
 */
function answerWithBotButton(sourceUrl: string) {
	return {
		...ANSWER_OPTIONS,
		button: {
			text: "Открыть бот и вставить ссылку",
			start_parameter: pendingLinks.set(sourceUrl),
		},
	};
}

export const inlineComposer = new Composer()
	.extend(composer)
	.inlineQuery(/https?:\/\/\S+/i, async (context) => {
		const { results, fallbackUrl } = await resolveQuery(context.query);
		return context.answer(
			results,
			fallbackUrl ? answerWithBotButton(fallbackUrl) : ANSWER_OPTIONS,
		);
	});
