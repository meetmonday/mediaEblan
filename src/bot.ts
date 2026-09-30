import { Bot } from "gramio";
import { config } from "./config.ts";
import { mediaComposer } from "./handlers/chat.ts";
import { guestComposer } from "./handlers/guest.ts";
import { inlineComposer } from "./handlers/inline.ts";
import { startComposer } from "./handlers/start.ts";
import { composer } from "./plugins/index.ts";

export const bot = new Bot(config.BOT_TOKEN)
	.extend(composer)
	.extend(startComposer)
	.extend(mediaComposer)
	.extend(inlineComposer)
	.extend(guestComposer)
	.onStart(({ info }) => {
		console.log(`✨ Bot ${info.username} was started!`);
		void bot.syncCommands();
	})
	.onError(({ error }) => console.error("[bot]", error));
