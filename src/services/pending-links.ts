import { randomBytes } from "node:crypto";

const TTL_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 128;

interface PendingLink {
	url: string;
	expiresAt: number;
}

const pending = new Map<string, PendingLink>();

/**
 * Short-lived store for URLs that inline mode couldn't serve directly.
 * The returned token fits Telegram's 64-char `start_parameter` limit and
 * is exchanged for the original URL on `/start <token>`.
 */
export const pendingLinks = {
	set(url: string): string {
		if (pending.size >= MAX_ENTRIES) {
			const oldest = pending.keys().next().value;
			if (oldest !== undefined) pending.delete(oldest);
		}
		const token = randomBytes(8).toString("base64url");
		pending.set(token, { url, expiresAt: Date.now() + TTL_MS });
		return token;
	},
	get(token: string): string | null {
		const entry = pending.get(token);
		if (!entry) return null;
		pending.delete(token);
		if (Date.now() > entry.expiresAt) return null;
		return entry.url;
	},
};
