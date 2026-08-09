// Sets required environment variables for tests.
// ??= ensures real values take precedence if already set.
process.env.BOT_TOKEN ??= "test";
process.env.DOWNLOAD_DIR ??= "/tmp/opencode/test-media";
process.env.PIXIV_INLINE_PROXY ??= "i.pixiv.re";
