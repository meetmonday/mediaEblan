import { randomBytes } from "node:crypto";
import { createBoundedStore } from "./bounded-store.ts";

const TTL_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 128;

interface PendingLink {
	url: string;
	expiresAt: number;
}

const store = createBoundedStore<PendingLink>(MAX_ENTRIES);

/**
 * Short-lived store for URLs that inline mode couldn't serve directly.
 * The returned token fits Telegram's 64-char `start_parameter` limit and
 * is exchanged for the original URL on `/start <token>` — once only.
 */
export const pendingLinks = {
	set(url: string): string {
		const token = randomBytes(8).toString("base64url");
		store.set(token, { url, expiresAt: Date.now() + TTL_MS });
		return token;
	},
	get(token: string): string | null {
		const entry = store.get(token);
		if (!entry) return null;
		store.delete(token);
		if (Date.now() > entry.expiresAt) return null;
		return entry.url;
	},
};
