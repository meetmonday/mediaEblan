import env from "env-var";

export const config = {
	NODE_ENV: env
		.get("NODE_ENV")
		.default("development")
		.asEnum(["production", "test", "development"]),
	BOT_TOKEN: env.get("BOT_TOKEN").required().asString(),

	LOCK_STORE: env.get("LOCK_STORE").default("memory").asEnum(["memory"]),

	// Pixiv PHPSESSID — allows full-resolution and R-18 downloads
	PIXIV_COOKIE: env.get("PIXIV_COOKIE").default("").asString(),

	// Hostname of a pixiv reverse-proxy for inline mode (Telegram can't send
	// the Referer header that i.pximg.net requires). Empty disables pixiv inline.
	PIXIV_INLINE_PROXY: env
		.get("PIXIV_INLINE_PROXY")
		.default("i.pixiv.re")
		.asString(),

	// Where downloaded media is stored before sending (tmpfs in Docker)
	DOWNLOAD_DIR: env.get("DOWNLOAD_DIR").default("tmp").asString(),

	// Max video size in MB before ffmpeg compression kicks in
	MAX_FILE_SIZE_MB: env.get("MAX_FILE_SIZE_MB").default("50").asIntPositive(),
};
