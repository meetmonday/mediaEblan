import { stat } from "node:fs/promises";
import type { Subprocess } from "bun";

export class CompressionError extends Error {}

export async function fileSize(path: string): Promise<number> {
	try {
		return (await stat(path)).size;
	} catch {
		return Number.POSITIVE_INFINITY;
	}
}

async function ffprobeDuration(path: string): Promise<number | null> {
	let proc: Subprocess<"pipe", "pipe", "pipe">;
	try {
		proc = Bun.spawn(
			[
				"ffprobe",
				"-v",
				"error",
				"-show_entries",
				"format=duration",
				"-of",
				"csv=p=0",
				path,
			],
			{ stdout: "pipe", stderr: "pipe" },
		);
	} catch {
		throw new CompressionError("ffmpeg не установлен — не могу сжать видео");
	}
	const exitCode = await proc.exited;
	if (exitCode !== 0) return null;
	const value = Number((await new Response(proc.stdout).text()).trim());
	return Number.isFinite(value) && value > 0 ? value : null;
}

async function runFfmpeg(args: string[]): Promise<void> {
	let proc: Subprocess<"pipe", "pipe", "pipe">;
	try {
		proc = Bun.spawn(["ffmpeg", ...args], { stdout: "pipe", stderr: "pipe" });
	} catch {
		throw new CompressionError("ffmpeg не установлен — не могу сжать видео");
	}
	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		const stderr = await new Response(proc.stderr).text();
		throw new CompressionError(
			stderr.trim().split("\n").at(-1) ?? "ffmpeg failed",
		);
	}
}

/** Muxes an external audio track into a video without re-encoding (Reddit DASH). */
export async function muxAudio(
	videoPath: string,
	audioPath: string,
	outPath: string,
): Promise<void> {
	await runFfmpeg([
		"-y",
		"-i",
		videoPath,
		"-i",
		audioPath,
		"-c",
		"copy",
		"-movflags",
		"+faststart",
		outPath,
	]);
}

/**
 * Re-encodes the video to H.264/AAC MP4 small enough to fit `maxBytes`.
 * Two passes: bitrate-based, then a scaled-down fallback.
 */
export async function compressVideo(
	input: string,
	output: string,
	maxBytes: number,
): Promise<string> {
	const duration = await ffprobeDuration(input);
	if (duration === null)
		throw new CompressionError("Не удалось прочитать длительность видео");

	const audioBitrate = 96_000;
	const videoBudget = maxBytes * 8 * 0.9;
	const targetBitrate = Math.floor(videoBudget / duration) - audioBitrate;
	if (targetBitrate < 200_000) {
		throw new CompressionError(
			"Видео слишком длинное, чтобы сжать его до лимита",
		);
	}

	const pass = (
		bitrate: number,
		maxrate: number,
		bufsize: number,
		audio: string,
		vf?: string,
	) =>
		runFfmpeg([
			"-y",
			"-i",
			input,
			...(vf ? ["-vf", vf] : []),
			"-c:v",
			"libx264",
			"-preset",
			"veryfast",
			"-b:v",
			String(bitrate),
			"-maxrate",
			String(maxrate),
			"-bufsize",
			String(bufsize),
			"-c:a",
			"aac",
			"-b:a",
			audio,
			"-movflags",
			"+faststart",
			output,
		]);

	await pass(
		targetBitrate,
		Math.floor(targetBitrate * 1.1),
		targetBitrate * 2,
		"128k",
	);
	if ((await fileSize(output)) <= maxBytes) return output;

	await pass(
		Math.floor(targetBitrate * 0.5),
		Math.floor(targetBitrate * 0.55),
		targetBitrate,
		"96k",
		"scale=min(720\\,iw):-2",
	);
	if ((await fileSize(output)) <= maxBytes) return output;

	throw new CompressionError("Сжатие не уложилось в лимит размера");
}
