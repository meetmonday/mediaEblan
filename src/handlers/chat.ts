import { Composer } from "gramio";
import { sendMedia } from "../media/sender.ts";
import { composer } from "../plugins/index.ts";
import { findMediaUrl } from "../providers/registry.ts";

export const mediaComposer = new Composer()
	.extend(composer)
	.hears(/https?:\/\/\S+/i, (context) => {
		const url = findMediaUrl(context.text ?? "");
		if (!url) return;
		return sendMedia(context, url);
	});
