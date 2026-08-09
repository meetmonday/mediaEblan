import { pixivProvider } from "./pixiv.ts";
import { redditProvider } from "./reddit.ts";
import { twitterProvider } from "./twitter.ts";
import type { Provider } from "./types.ts";

export const providers: Provider[] = [
	twitterProvider,
	pixivProvider,
	redditProvider,
];

/** Human-readable names of the sites supported by the registered providers. */
export function listSupportedSites(): string[] {
	return [...new Set(providers.flatMap((provider) => provider.sites))];
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
