import { Composer } from "gramio";
import { config } from "../config.ts";
import { openBotResult, resolveQuery } from "../media/query.ts";
import { composer } from "../plugins/index.ts";

/**
 * Bot API 10 guest mode: the bot is summoned in a chat it isn't a member of.
 * It can't post media there, so the only way to answer is `answerGuestQuery`
 * with exactly **one** inline result — which the caller then sends itself.
 *
 * The resolution therefore mirrors inline mode and never downloads: a cached
 * `file_id`, the provider's direct media URLs, or a text article. A multi-item
 * resolution (an album) degrades to its first item, and anything that needs a
 * download is handed over to the bot's own PM as a deep link.
 */
export const guestComposer = new Composer().extend(composer).guestQuery(
	// Every guest message is answered — the trigger is the presence of a
	// link, decided inside the handler by `resolveQuery`.
	() => true,
	async (context) => {
		if (!config.GUEST_MODE) return;
		if (!context.guestQueryId) return;

		const { results, fallbackUrl } = await resolveQuery(
			context.text ?? context.caption ?? "",
		);
		const [result] = results;
		await context.answerGuestQuery(
			result ?? openBotResult(fallbackUrl, context.bot.info?.username),
		);
	},
);
