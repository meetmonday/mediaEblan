import { Verrou } from "@verrou/core";
import { memoryStore } from "@verrou/core/drivers/memory";

/**
 * Per-resource mutex. The memory store is enough for a single-process bot —
 * swap `default`/`stores` for a Redis driver to run several instances.
 */
export const verrou = new Verrou({
	default: "memory",
	stores: {
		memory: { driver: memoryStore() },
	},
});
