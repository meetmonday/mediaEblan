import { bold, Composer, type FormattableString, format } from "gramio";
import { sendMedia } from "../media/sender.ts";
import { composer } from "../plugins/index.ts";
import {
	listSupportedSites,
	supportedSitesText,
} from "../providers/registry.ts";
import { pendingLinks } from "../services/pending-links.ts";

function welcomeMessage(): FormattableString {
	return format`${bold("mediaEblan")}\n\nПришли ссылку — пришлю медиа сюда.\n\nПоддерживаются:\n${supportedSitesText()}\n\nВ любом чате бота можно вызвать через инлайн-режим.`;
}

export const startComposer = new Composer()
	.extend(composer)
	.command(
		"start",
		{ description: `Скачать медиа из ${listSupportedSites().join(", ")}` },
		async (context) => {
			const sourceUrl = context.args ? pendingLinks.get(context.args) : null;
			if (sourceUrl) {
				await sendMedia(context, new URL(sourceUrl), {
					withSourceButtons: true,
					reply: false,
				});
				await context.delete().catch(() => {});
				return;
			}
			return context.send(welcomeMessage());
		},
	);
