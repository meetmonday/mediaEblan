import { bold, Composer, type FormattableString, format } from "gramio";
import { sendMedia } from "../media/sender.ts";
import { composer } from "../plugins/index.ts";
import { listSupportedSites } from "../providers/registry.ts";
import { pendingLinks } from "../services/pending-links.ts";

function welcomeMessage(): FormattableString {
	return format`${bold("mediaEblan")}\n\nПришли ссылку — пришлю медиа сюда.\n\nПоддерживаются: ${listSupportedSites().join(", ")}\n\nВ любом чате бота можно вызвать через инлайн-режим.`;
}

export const startComposer = new Composer()
	.extend(composer)
	.command(
		"start",
		{ description: `Скачать медиа из ${listSupportedSites().join(", ")}` },
		(context) => {
			const sourceUrl = context.args ? pendingLinks.get(context.args) : null;
			if (sourceUrl) {
				return sendMedia(context, new URL(sourceUrl));
			}
			return context.send(welcomeMessage());
		},
	);
