import "../setup.ts";
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { TelegramTestEnvironment } from "@gramio/test";
import { bot } from "../../src/bot.ts";
import { resolveProvider } from "../../src/providers/registry.ts";

const links = readFileSync(join(import.meta.dir, "../links.txt"), "utf-8")
	.split("\n")
	.map((line) => line.trim())
	.filter((line) => line.length > 0 && !line.startsWith("#"));

/** Groups links by the provider that matches them — no per-provider files needed. */
const grouped = new Map<string, string[]>();
for (const link of links) {
	const name = resolveProvider(new URL(link))?.name ?? "unknown";
	grouped.set(name, [...(grouped.get(name) ?? []), link]);
}

function extractId(url: string): string {
	const match = url.match(
		/(?:status|artworks|comments|gallery)\/([a-zA-Z0-9]+)|(?:\/s\/)([a-zA-Z0-9]+)/,
	);
	return (
		match?.[1] ?? match?.[2] ?? url.replace(/^https?:\/\//, "").slice(0, 30)
	);
}

/** Runs the real chat flow (link → provider → download → caption → media send). */
async function assertFlowSendsMedia(link: string): Promise<void> {
	const env = new TelegramTestEnvironment(bot);
	const user = env.createUser();

	await user.sendMessage(link);

	const media = [
		...env.filterApiCalls("sendPhoto"),
		...env.filterApiCalls("sendVideo"),
		...env.filterApiCalls("sendMediaGroup"),
	];
	if (media.length === 0) {
		throw new Error(
			`No media sent for ${link}. Bot error reply: ${String(env.lastApiCall("sendMessage")?.params.text)}`,
		);
	}
	const hasCaption = media.some((call) => {
		if (call.method === "sendMediaGroup") {
			return (
				Array.isArray(call.params.media) &&
				call.params.media.some((item) => item.caption)
			);
		}
		return Boolean(call.params.caption);
	});
	expect(hasCaption).toBe(true);
}

for (const [name, providerLinks] of grouped) {
	describe(`e2e: ${name}`, () => {
		for (const link of providerLinks) {
			test(extractId(link), () => assertFlowSendsMedia(link), 60_000);
		}
	});
}

afterAll(() =>
	rm("/tmp/opencode/test-media", { recursive: true, force: true }),
);
