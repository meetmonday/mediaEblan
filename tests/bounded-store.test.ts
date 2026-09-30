import { describe, expect, test } from "bun:test";
import { createBoundedStore } from "../src/services/bounded-store.ts";
import { pendingLinks } from "../src/services/pending-links.ts";

describe("createBoundedStore", () => {
	test("keeps insertion order and drops the oldest key at the limit", () => {
		const store = createBoundedStore<number>(2);
		store.set("a", 1);
		store.set("b", 2);
		store.set("c", 3);

		expect(store.size).toBe(2);
		expect(store.get("a")).toBeUndefined();
		expect(store.get("b")).toBe(2);
		expect(store.get("c")).toBe(3);
	});

	test("overwriting an existing key evicts nothing", () => {
		const store = createBoundedStore<number>(2);
		store.set("a", 1);
		store.set("b", 2);
		store.set("a", 10);

		expect(store.size).toBe(2);
		expect(store.get("a")).toBe(10);
		expect(store.get("b")).toBe(2);
	});

	test("delete removes the entry", () => {
		const store = createBoundedStore<number>(2);
		store.set("a", 1);
		store.set("b", 2);
		store.delete("a");

		expect(store.get("a")).toBeUndefined();
		expect(store.size).toBe(1);
	});
});

describe("pendingLinks", () => {
	test("a token is exchanged for the URL exactly once", () => {
		const token = pendingLinks.set("https://example.com/post");
		expect(pendingLinks.get(token)).toBe("https://example.com/post");
		expect(pendingLinks.get(token)).toBeNull();
	});

	test("an unknown token is null", () => {
		expect(pendingLinks.get("nope")).toBeNull();
	});
});
