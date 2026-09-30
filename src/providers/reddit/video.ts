import { rm } from "node:fs/promises";
import { join } from "node:path";
import { muxAudio } from "../../services/ffmpeg.ts";
import { ProviderError } from "../errors.ts";
import { downloadTo, fetchWithTimeout } from "../http.ts";
import type { MediaItem } from "../types.ts";
import { NAME, REDDIT_HEADERS, type RedditPost, redditVideo } from "./post.ts";

/** Audio candidates Reddit serves next to the video, best quality first. */
const AUDIO_NAMES = [
	"CMAF_AUDIO_128.mp4",
	"CMAF_AUDIO_64.mp4",
	"DASH_audio.mp4",
];

function stripQuery(url: string): string {
	return url.split("?")[0] ?? url;
}

function videoBase(videoUrl: string): string {
	const url = new URL(videoUrl);
	const mediaId = url.pathname.split("/")[1];
	return `https://v.redd.it/${mediaId}`;
}

/** Best-effort probe — a missing audio track is not an error, just no audio. */
async function urlExists(url: string): Promise<boolean> {
	try {
		const response = await fetchWithTimeout(url, {
			headers: REDDIT_HEADERS,
			method: "HEAD",
		});
		return response.ok;
	} catch {
		return false;
	}
}

/** Best-effort DASH manifest parse — same reasoning as `urlExists`. */
async function audioUrlFromManifest(dashUrl: string): Promise<string | null> {
	try {
		const response = await fetchWithTimeout(dashUrl, {
			headers: REDDIT_HEADERS,
		});
		const xml = await response.text();
		const match = xml.match(
			/mimeType="audio\/mp4"[^>]*>[\s\S]*?<BaseURL>([^<]+)<\/BaseURL>/,
		);
		return match?.[1] ? new URL(match[1], dashUrl).toString() : null;
	} catch {
		return null;
	}
}

/** Finds the audio track URL: from the DASH manifest, then by guessing. */
async function findAudioUrl(video: {
	dash_url?: string;
	fallback_url?: string;
}): Promise<string | null> {
	if (video.dash_url) {
		const fromManifest = await audioUrlFromManifest(video.dash_url);
		if (fromManifest) return fromManifest;
	}
	if (!video.fallback_url) return null;

	const base = videoBase(video.fallback_url);
	for (const name of AUDIO_NAMES) {
		if (await urlExists(`${base}/${name}`)) return `${base}/${name}`;
	}
	return null;
}

async function removeQuietly(path: string): Promise<void> {
	await rm(path, { force: true }).catch(() => {});
}

/**
 * Downloads a v.redd.it video and muxes the separate audio track into it.
 * Audio is optional at every step: a post whose audio is missing, unreachable
 * or unmergeable is still worth sending as a silent video.
 */
export async function downloadVideo(
	post: RedditPost,
	id: string,
	downloadDir: string,
): Promise<MediaItem> {
	const video = redditVideo(post);
	if (!video?.fallback_url)
		throw new ProviderError(NAME, "Не удалось получить ссылку на видео");

	const videoPath = join(downloadDir, `${id}_video.mp4`);
	await downloadTo(stripQuery(video.fallback_url), videoPath);
	if (!video.has_audio) return { kind: "video", path: videoPath };

	const audioUrl = await findAudioUrl(video);
	if (!audioUrl) return { kind: "video", path: videoPath };

	const audioPath = join(downloadDir, `${id}_audio.mp4`);
	try {
		await downloadTo(audioUrl, audioPath);
	} catch {
		return { kind: "video", path: videoPath };
	}

	const mergedPath = join(downloadDir, `${id}.mp4`);
	try {
		await muxAudio(videoPath, audioPath, mergedPath);
		await Promise.all([removeQuietly(audioPath), removeQuietly(videoPath)]);
		return { kind: "video", path: mergedPath };
	} catch {
		await removeQuietly(audioPath);
		return { kind: "video", path: videoPath };
	}
}
