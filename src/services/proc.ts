import type { Subprocess } from "bun";

export class ProcError extends Error {
	constructor(
		message: string,
		/** `null` when the binary itself couldn't be started (e.g. not installed). */
		readonly exitCode: number | null,
	) {
		super(message);
	}
}

/**
 * Runs a binary with piped stdio and waits for it to finish.
 * Throws `ProcError` when the binary can't be started (spawn failure) or
 * exits non-zero — with the last line of stderr as the message.
 */
export async function runBinary(
	binary: string,
	args: string[],
	notInstalledMessage: string,
): Promise<{ stdout: string; stderr: string }> {
	let proc: Subprocess<"pipe", "pipe", "pipe">;
	try {
		proc = Bun.spawn([binary, ...args], { stdout: "pipe", stderr: "pipe" });
	} catch {
		throw new ProcError(notInstalledMessage, null);
	}
	const exitCode = await proc.exited;
	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	if (exitCode !== 0) {
		throw new ProcError(
			stderr.trim().split("\n").at(-1) ?? `${binary} failed`,
			exitCode,
		);
	}
	return { stdout, stderr };
}
