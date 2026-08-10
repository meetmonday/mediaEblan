/**
 * HTTP-layer failure — non-2xx status, malformed body, or a transport problem.
 * The pipeline treats every `HttpError` (including `NetworkError`) as retryable.
 * Re-exported from `providers/http.ts` for backward compatibility.
 */
export class HttpError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "HttpError";
	}
}

/**
 * Transient transport failure — timeout, connection reset, DNS. Retryable.
 * Extends `HttpError` so the pipeline's `instanceof HttpError` retry check
 * covers it without extra branches. Providers that wrap transport errors in
 * their own class should extend this instead of `ProviderError`.
 */
export class NetworkError extends HttpError {
	constructor(message: string) {
		super(message);
		this.name = "NetworkError";
	}
}

/**
 * Semantic provider error — the provider understood the request but couldn't
 * fulfill it (bad link, no media, unsupported content). Never retried; the
 * message is shown to the user as-is.
 */
export class ProviderError extends Error {
	constructor(
		/** Provider name, e.g. `"twitter"` — for diagnostics. */
		readonly provider: string,
		message: string,
	) {
		super(message);
		this.name = "ProviderError";
	}
}
