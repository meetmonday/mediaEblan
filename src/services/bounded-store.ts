/**
 * Insertion-ordered map with a hard size limit: adding a key once `maxEntries`
 * is reached drops the oldest one. Backing store for the file_id cache and for
 * the short-lived inline fallback links.
 */
export interface BoundedStore<T> {
	get(key: string): T | undefined;
	set(key: string, value: T): void;
	delete(key: string): void;
	readonly size: number;
}

export function createBoundedStore<T>(maxEntries: number): BoundedStore<T> {
	const entries = new Map<string, T>();

	return {
		get: (key) => entries.get(key),
		set(key, value) {
			// Overwriting an existing key must not evict anything.
			if (!entries.has(key) && entries.size >= maxEntries) {
				const oldest = entries.keys().next().value;
				if (oldest !== undefined) entries.delete(oldest);
			}
			entries.set(key, value);
		},
		delete: (key) => {
			entries.delete(key);
		},
		get size() {
			return entries.size;
		},
	};
}
