import { autoAnswerCallbackQuery } from "@gramio/auto-answer-callback-query";
import { autoRetry } from "@gramio/auto-retry";
import { mediaCache } from "@gramio/media-cache";
import { mediaGroup } from "@gramio/media-group";
import { Composer } from "gramio";
import { defineView } from "../shared/views/builder.ts";

export const composer = new Composer({ name: "main" })
	.extend(autoAnswerCallbackQuery())
	.extend(mediaGroup())
	.extend(autoRetry())
	.extend(mediaCache())
	.derive(["message", "callback_query"], (context) => ({
		render: defineView.buildRender(context, {}),
	}))
	.as("scoped");

export type BotType = typeof composer;
