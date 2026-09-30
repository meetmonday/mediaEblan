import { describe, expect, test } from "bun:test";
import { createServer } from "node:net";
import { HttpError } from "../src/providers/errors.ts";
import { fetchWithTimeout } from "../src/providers/http.ts";

type TestServer = { port: number; close: () => void };

/** Accepts connections then immediately destroys the socket. */
function socketClosingServer(): Promise<TestServer> {
	return new Promise((resolve) => {
		const server = createServer((socket) => socket.destroy());
		server.listen(0, () => {
			const { port } = server.address() as { port: number };
			resolve({ port, close: () => server.close() });
		});
	});
}

/** Accepts connections but never answers — for timeout tests. */
function silentServer(): Promise<TestServer> {
	return new Promise((resolve) => {
		const server = createServer(() => {});
		server.listen(0, () => {
			const { port } = server.address() as { port: number };
			resolve({ port, close: () => server.close() });
		});
	});
}

describe("http", () => {
	test("abrupt socket close is wrapped as HttpError", async () => {
		const { port, close } = await socketClosingServer();
		try {
			await expect(
				fetchWithTimeout(`http://127.0.0.1:${port}`),
			).rejects.toThrow(HttpError);
		} finally {
			close();
		}
	});

	test("timeout is wrapped as HttpError with hostname", async () => {
		const { port, close } = await silentServer();
		try {
			const error = await fetchWithTimeout(
				`http://127.0.0.1:${port}`,
				undefined,
				50,
			).catch((e) => e);
			expect(error).toBeInstanceOf(HttpError);
			expect((error as Error).message.startsWith("Таймаут запроса к")).toBe(
				true,
			);
		} finally {
			close();
		}
	});
});
