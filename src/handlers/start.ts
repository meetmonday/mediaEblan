import { bold, Composer, format } from "gramio";
import { composer } from "../plugins/index.ts";
import { listSupportedSites } from "../providers/registry.ts";

export const startComposer = new Composer()
	.extend(composer)
	.command(
		"start",
		{ description: `Скачать медиа из ${listSupportedSites().join(", ")}` },
		(context) =>
			context.send(
				format`${bold("mediaEblan")}\n\nПришли ссылку — пришлю медиа сюда.\n\nПоддерживаются: ${listSupportedSites().join(", ")}\n\nВ любом чате бота можно вызвать через инлайн-режим.`,
			),
	);
