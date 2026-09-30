import { HttpError, NetworkError } from "./errors.ts";

const DEFAULT_TIMEOUT = 15_000;

function isAbort(error: unknown): boolean {
	return (
		error instanceof Error &&
		(error.name === "TimeoutError" || error.name === "AbortError")
	);
}

async function withTimeout<T>(
	url: string,
	timeoutMs: number,
	fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fn(controller.signal);
	} catch (error) {
		if (error instanceof HttpError) throw error;
		if (isAbort(error)) {
			throw new NetworkError(`Таймаут запроса к ${new URL(url).hostname}`);
		}
		throw new NetworkError(`Не удалось связаться с ${new URL(url).hostname}`);
	} finally {
		clearTimeout(timer);
	}
}

/** `fetch` with a hard timeout covering the whole response body, not just headers. */
export function fetchWithTimeout(
	url: string,
	init?: RequestInit,
	timeoutMs = DEFAULT_TIMEOUT,
): Promise<Response> {
	return withTimeout(url, timeoutMs, async (signal) => {
		const response = await fetch(url, { ...init, signal });
		if (!response.ok) {
			throw new HttpError(
				`HTTP ${response.status} ${response.statusText} — ${new URL(url).hostname}`,
			);
		}
		return response;
	});
}

/**
 * Fetches with `redirect: "manual"` — the raw 3xx response is returned so the
 * caller can follow redirects itself (e.g. share-link resolution).
 * Returns `null` on any error or timeout.
 */
export async function fetchRedirect(
	url: string,
	init?: RequestInit,
	timeoutMs = DEFAULT_TIMEOUT,
): Promise<Response | null> {
	try {
		return await withTimeout(url, timeoutMs, (signal) =>
			fetch(url, { ...init, redirect: "manual", signal }),
		);
	} catch {
		return null;
	}
}

/** Fetches JSON with a full-body timeout, throwing HttpError on non-2xx or non-JSON. */
export async function fetchJson<T>(
	url: string,
	init?: RequestInit,
	timeoutMs = DEFAULT_TIMEOUT,
): Promise<T> {
	return withTimeout(url, timeoutMs, async (signal) => {
		const response = await fetch(url, { ...init, signal });
		if (!response.ok) {
			throw new HttpError(
				`HTTP ${response.status} ${response.statusText} — ${new URL(url).hostname}`,
			);
		}
		try {
			return (await response.json()) as T;
		} catch {
			throw new HttpError(`Не JSON ответ от ${new URL(url).hostname}`);
		}
	});
}

/** Downloads a URL to disk with a full-body timeout. Buffered write — no hanging streams. */
export async function downloadTo(
	url: string,
	outPath: string,
	init?: RequestInit,
	timeoutMs = DEFAULT_TIMEOUT,
): Promise<void> {
	await withTimeout(url, timeoutMs, async (signal) => {
		const response = await fetch(url, { ...init, signal });
		if (!response.ok) {
			throw new HttpError(
				`HTTP ${response.status} ${response.statusText} — ${new URL(url).hostname}`,
			);
		}
		const data = await response.arrayBuffer();
		await Bun.write(outPath, data);
	});
}
