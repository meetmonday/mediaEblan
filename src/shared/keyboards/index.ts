import { InlineKeyboard } from "gramio";

/** `https://t.me/share/url?url=…` — opens Telegram's share dialog for `url`. */
export function shareUrlFor(url: string): string {
	return `https://t.me/share/url?url=${encodeURIComponent(url)}`;
}

/**
 * Two buttons pinned under a media message instead of the plain source link:
 * «Открыть» opens the source, «Поделиться» opens Telegram's share dialog.
 */
export function sourceButtons(sourceUrl: string): InlineKeyboard {
	return new InlineKeyboard()
		.url("Открыть", sourceUrl)
		.url("Поделиться", shareUrlFor(sourceUrl));
}
