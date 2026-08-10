import { pixivProvider } from "./pixiv.ts";
import { redditProvider } from "./reddit.ts";
import { tiktokProvider } from "./tiktok.ts";
import { trashboxProvider } from "./trashbox.ts";
import { twitterProvider } from "./twitter.ts";
import type { Provider } from "./types.ts";

export const providers: Provider[] = [
	twitterProvider,
	tiktokProvider,
	pixivProvider,
	redditProvider,
	trashboxProvider,
];

/** Human-readable names of all sites supported by the bot. */
export function listSupportedSites(): string[] {
	return [...new Set(providers.flatMap((provider) => provider.sites))];
}

/** Supported sites as a bulleted list, one per line — for user-facing text. */
export function supportedSitesText(): string {
	return listSupportedSites()
		.map((site) => `• ${site}`)
		.join("\n");
}

const URL_PATTERN = /https?:\/\/[^\s<>"'()]+/gi;

/** Returns the first URL in the text that belongs to a supported provider. */
export function findMediaUrl(text: string): URL | null {
	for (const raw of text.match(URL_PATTERN) ?? []) {
		let url: URL;
		try {
			url = new URL(raw);
		} catch {
			continue;
		}
		if (providers.some((provider) => provider.match(url))) return url;
	}
	return null;
}

/** Resolves the provider that can handle the given URL. */
export function resolveProvider(url: URL): Provider | null {
	return providers.find((provider) => provider.match(url)) ?? null;
}
