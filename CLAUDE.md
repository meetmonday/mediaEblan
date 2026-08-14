# mediaEblan

> This file is read by Claude Code and other AI agents to understand the project.
> **Keep it accurate.** Update it whenever the structure or conventions change.

## AI assistant setup

This project ships with a [GramIO Skill](https://gramio.dev/) that teaches your AI assistant the framework — examples, plugin guides, type-safe callback patterns, formatting rules, and migration playbooks.

```bash
bun x skills add gramiojs/documentation/skills
```

Once installed, Claude Code, Cursor, and other agents auto-load GramIO knowledge when they detect bot code. Without it, agents tend to hallucinate `parse_mode: "HTML"`, `ctx.data.startsWith(...)`, or `ctx as any` — patterns this project explicitly forbids (see Conventions).

### AI assistant behavior

Before writing or modifying any code that imports `gramio` or `@gramio/*`, or touches files under `src/handlers/`, `src/media/`, `src/providers/`, `src/plugins/`, `src/shared/` — **invoke the `gramio` skill via the Skill tool first**. Do not rely on training-data knowledge of the framework: APIs shift fast, and the skill is the single source of truth for current patterns.

## Tech Stack

- **Framework**: [GramIO](https://gramio.dev/)
- **Linter**: Biome
- **Plugins**: Auto answer callback query, Auto-retry, Views, Media-group, Media-cache

## Project Structure

```
src/
├── index.ts            # Entry point — starts the bot, graceful shutdown
├── bot.ts              # Bot instance — shared composer + handler composers
├── config.ts           # Typed environment variables (env-var)
├── plugins/
│   └── index.ts        # Shared Composer (named, scoped) — extend in every handler
├── handlers/           # Command/event composers (each extends the shared composer)
│   ├── chat.ts         # hears(/https?:\/\/\S+/) → sendMedia via the pipeline
│   ├── inline.ts       # inline results via resolveDirect / Trashbox article / cached
│   └── start.ts        # /start, deep-link tokens (pendingLinks) → sendMedia
├── providers/          # Media source adapters — one file per site
│   ├── types.ts        # Provider, ProviderResult, DirectMediaResult, MediaItem/Metadata
│   ├── errors.ts       # ProviderError / HttpError / NetworkError hierarchy
│   ├── helpers.ts      # extensionOf, makeAuthor, epochToIso, kindFromPath, downloadMediaSources
│   ├── http.ts         # fetchWithTimeout, fetchJson, downloadTo, fetchRedirect
│   ├── registry.ts     # providers[], resolveProvider, findMediaUrl, supported sites
│   ├── twitter|tiktok|pixiv|reddit.ts   # site adapters (on helpers)
│   └── trashbox.ts     # thin Provider adapter over services/trashbox.ts
├── media/              # Media delivery pipeline (domain-agnostic)
│   ├── pipeline.ts     # processMedia: lock → cache → fetch+retry → compress → send
│   ├── sender.ts       # senderFrom — adapts a GramIO context to MediaSender
│   ├── caption.ts      # CaptionBuilder / captionFor / cachedCaption
│   ├── cache.ts        # in-memory URL → file_id cache
│   └── ffmpeg.ts       # muxAudio, compressVideo, fileSize
├── services/           # Cross-cutting infrastructure
│   ├── locks.ts        # Verrou locker (per-resource mutex)
│   ├── proc.ts         # runBinary — spawn + stderr parsing (yt-dlp, ffmpeg)
│   ├── trashbox.ts     # Trashbox domain: resolve/fetch/html-clean/comment message
│   └── pending-links.ts # short-lived tokens for the inline fallback button
└── shared/
    ├── keyboards/      # Reusable Keyboard / InlineKeyboard builders
    ├── callback-data/  # CallbackData class definitions
    └── views/          # defineView (initViewsBuilder) — re-renderable components
```

## Key Commands

```bash
bun dev          # Start with hot-reload
bun start        # Production start
bun lint         # Check code style
bun lint:fix     # Auto-fix lint issues
bun test         # Run unit/flow tests (mocked providers, no network)
bun test:e2e     # Real-network e2e over links.txt (on-demand, see Testing)
```

## Testing

- `bun test` — unit + flow tests with **mocked** network (no real requests):
  - `tests/helpers.test.ts` — provider helpers (`extensionOf`, `downloadMediaSources`, cleanup-on-error, …)
  - `tests/{twitter,tiktok,pixiv,reddit}.test.ts` — provider `resolveDirect`/`fetch` against mocked APIs
  - `tests/trashbox-unit.test.ts` — Trashbox pure functions (`htmlCleaner`, `commentMediaSources`, `firstImgSrc`, `commentMessage`)
  - `tests/http.test.ts` — `fetchWithTimeout` transport behavior (timeout, socket close)
  - `tests/flow.test.ts` — full bot flow via `TelegramTestEnvironment` with a fake provider (chat/inline/photo/video/multi/text/error/retry)
- `bun test:e2e` — real e2e (`tests/e2e/links.e2e.ts`): for each link in `tests/links.txt` runs the full flow (link → provider → download → caption → sendPhoto/sendVideo). Groups are derived dynamically from `resolveProvider`, so a new provider needs **only** a link in `links.txt` — no new files or scripts.
- Run e2e **only** when a provider module or bot-wide media handling changes, and filter a single provider with `-t`: `bun test ./tests/e2e/links.e2e.ts -t pixiv` (or `-t twitter`). `.e2e.ts` is never picked up by plain `bun test`.
- e2e is real-network and may require `PIXIV_COOKIE` in `.env` for restricted Pixiv works.

## Conventions

### Context

- **Context fields are camelCase**: GramIO normalizes all Telegram snake_case fields — use `ctx.from.firstName`, `ctx.chat.lastName`, `ctx.message.messageId`, etc.
- **Never use raw Telegram snake_case** (`first_name`, `chat_id`, `message_id`) when accessing context properties.
- **Never touch `ctx.payload` or `ctx.update.*`** — those are raw internal objects. Every Telegram field has a camelCase getter directly on the context (`ctx.from`, `ctx.chatId`, `ctx.messageId`, `ctx.text`, `ctx.data`, `ctx.queryData`).
- **Type derivation, not casts**: after `.derive()` / `.decorate()` / `.extend(plugin)` the new fields appear on the inferred context type automatically. Never write `ctx as unknown as { myField }`. Export `BotContext = typeof composer['_']['context']` if you need to reuse the type.

### Callback queries

- **Never parse `ctx.data` manually with `startsWith` / `split`.** `CallbackData.pack()` produces a 6-character sha1 hash prefix + serialized payload — literal-prefix checks like `ctx.data?.startsWith("nav:")` will silently never match at runtime.
- Use one of these four patterns, picked by the shape of the data:
  - **Fixed string** → `bot.callbackQuery("refresh", handler)`
  - **Variable slug** → `bot.callbackQuery(/^user_(\d+)$/, (ctx) => ctx.match![1])`
  - **Structured payload** → `new CallbackData("nav").enum("to", [...])` + `bot.callbackQuery(nav, (ctx) => ctx.queryData.to)` (preferred for >1 field)
  - **Stale-safe unpack** → `nav.safeUnpack(ctx.data!)` returns `{ success, data }` for inline keyboards that may outlive a schema change

### Formatting

- **Never set `parse_mode`.** GramIO's `format` builds `MessageEntity[]` and passes them automatically — adding `parse_mode: "HTML"` or `"MarkdownV2"` corrupts the message.
- **Never call native `Array.prototype.join` on formatted values** — it triggers `.toString()` and silently drops every entity. Use `import { join } from "gramio"` and `join(items, (x) => bold(x), "\n")`.
- **Always wrap composed/reused styled content in `` format`...` ``.** Embedding a `Formattable` in a plain template literal strips entities.
- **Never call `.toString()` on a `FormattableString`.** Pass it directly as the `text` / `caption` argument.

### TypeScript hygiene

- **No `any` anywhere** — no `ctx: any`, `as any`, `<any>`, or implicit-any handler params. Derive types from `ContextType<typeof bot, "update_name">` or the exported `BotType`. If a value is genuinely unknown at a system boundary, use `unknown` + narrowing.

### Providers

- **Error hierarchy** (`providers/errors.ts`) is load-bearing — the pipeline's retry policy depends on it:
  - `ProviderError(provider, message)` — *semantic*: bad link, no media, unsupported content. The message is shown to the user **as-is** and is **never retried**. Throw it with a user-facing Russian message.
  - `HttpError` — any HTTP-layer failure (non-2xx, bad body); **retryable**.
  - `NetworkError extends HttpError` — transient transport failure (timeout, connection reset); **retryable**. Use it for wrapped transport errors, or let the http helpers raise it for you.
  - The pipeline retries `HttpError`/`NetworkError` once, then rethrows; `ProviderError` surfaces immediately. Never `throw new Error(...)` from a provider — the message would leak as a generic failure.
- **Use the shared helpers** (`providers/helpers.ts`): `extensionOf` (extension from a URL), `makeAuthor` (author object), `epochToIso` (unix → ISO — **always** normalize dates at the provider boundary), `kindFromPath`/forced `kind`, and `downloadMediaSources(sources, dir, { sequential, headers, kind })` which cleans up partial downloads on failure. Pixiv must pass `sequential: true` — i.pximg.net throttles parallel connections.
- **Parse once**: each provider exports `parse(url): { id } | null` and reuses it in `match`, `fetch`, and `resolveDirect` instead of re-extracting the id.
- **Network calls** go through `providers/http.ts` (`fetchJson`, `fetchWithTimeout`, `downloadTo`, `fetchRedirect`) — they already wrap failures as `HttpError`/`NetworkError`.
- **Text-only results** (e.g. a comment without images) are returned as `ProviderResult.text: { content, disableLinkPreview, sourceUrl }` with `items: []`. `content` excludes the source link; the pipeline appends it as a `🔗 url` line (chat) or attaches the buttons (deep-link/inline). They are sent via `sendText`, not treated as errors.

## Architecture

### Plugin composition

All top-level plugins are registered once in `src/plugins/index.ts` as a shared `Composer`.
The composer is **named** (`{ name: "main" }`) and marked **`.as("scoped")`** — these two together are load-bearing:

- `name` enables structural deduplication: extending the same composer twice (e.g. via two routers) is a no-op the second time.
- `.as("scoped")` makes `derive`/`decorate` results propagate to the parent (the bot) instead of being trapped in a per-extend isolation group. Without it, types say `ctx.t` / `ctx.session` / `ctx.render` exist, but at runtime they would be missing in handlers.

Every handler file **must extend** this composer so it inherits full plugin typing:

```ts
import { Composer } from "gramio";
import { composer } from "../plugins/index.ts";

export const myComposer = new Composer()
    .extend(composer)
    .command("start", (ctx) => ctx.send("Hi!"));
```

> When adding a new shared sub-composer (e.g. `withUser` for auth/db loading), give it a `name`, end the chain with `.as("scoped")`, and **extend it on the bot BEFORE any router that uses it** — otherwise dedup will skip the runtime registration inside routers and `ctx.user` will exist only in the first router that ran. See [Production Architecture](https://gramio.dev/extend/middleware.md#production-architecture).

### Adding a new handler

1. Create `src/handlers/my-feature.ts` extending the shared composer
2. Import and chain it via `.extend(myComposer)` in `src/bot.ts`

### Media pipeline

`src/media/pipeline.ts` exposes `processMedia(url, sender, { withSourceButtons })` — the single path that turns a link into media, shared by chat (`handlers/chat.ts`) and deep-links (`handlers/start.ts`). Flow per URL:

1. **Lock** — Verrou per-URL mutex, so concurrent identical links are processed once.
2. **Cache hit** — in-memory `mediaCache` (URL → `file_id`) sends the stored `file_id` with `cachedCaption`, no re-download.
3. **Fetch** — `resolveProvider(url)`; a missing provider is a `MediaError("unsupported", …)` listing the supported sites.
4. **Retry** — `fetchProviderResult` retries once on `HttpError`/`NetworkError`, never on `ProviderError` (see Conventions).
5. **Text branch** — `result.items` empty with `result.text` → `sender.sendText(content, { disableLinkPreview }, keyboard)`; cached nothing. `text.content` must NOT include the source link — the provider passes it via `text.sourceUrl`, and the pipeline appends the `🔗 url` line in chat mode or attaches the buttons when `withSourceButtons`.
6. **Send** — videos above `MAX_FILE_SIZE_MB` are compressed via ffmpeg; single item → `sendPhoto`/`sendVideo`, several → `sendMediaGroup` (caption on the first item); the `file_id` is cached.
7. **Source buttons** — with `withSourceButtons` (deep-link flow + inline results) the `🔗 url` caption line is dropped and replaced by two URL buttons (`sourceButtons` in `shared/keyboards/index.ts`): «Открыть» opens the source, «Поделиться» opens `t.me/share/url`. Albums can't carry inline keyboards — `senderFrom` sends the buttons in a follow-up message (zero-width-space text).

`MediaSender` is a minimal interface (defined in `pipeline.ts`) so tests can inject a fake; each send method takes an optional `InlineKeyboard`. `senderFrom(context)` in `media/sender.ts` adapts a GramIO context. Captions are built by `CaptionBuilder`/`captionFor` in `media/caption.ts`; `captionFor`/`cachedCaption` take an `includeSourceLink` flag to suppress the source link line when buttons are used.

### Providers

`src/providers/` adapts each site to the uniform `Provider` interface (`types.ts`). Chat mode uses `fetch(url, downloadDir)` which downloads media; inline mode uses the optional `resolveDirect(url)` which returns publicly-embeddable URLs without downloading. Trashbox is a provider too: `providers/trashbox.ts` is a thin adapter over the domain logic in `services/trashbox.ts` (resolve, HTML cleaning, comment message).

**Adding a new provider** — the whole point of the refactor, no copy-paste:

1. Create `src/providers/<name>.ts`:
   - `match(url)` — decides whether the URL belongs to this provider (usually via an exported `parse`)
   - `fetch(url, downloadDir)` — returns `ProviderResult`; download via `downloadMediaSources`
   - `resolveDirect?(url)` — only when there are public URLs for inline mode
   - errors: `throw new ProviderError("<name>", "текст")` for semantic problems, or let the http helpers raise `HttpError`/`NetworkError`
2. Add the provider to the `providers` array in `registry.ts`.
3. Add a sample link to `tests/links.txt` — the e2e group is created automatically from `resolveProvider`.
4. Document any new env vars inline in `config.ts`.

### Views

`src/shared/views/` contains reusable message components built with `@gramio/views`.
`defineView` is created via `initViewsBuilder` and exported from `src/shared/views/builder.ts`.
Views use a method-chaining builder (`this.response`) and auto-detect whether to send a new message or edit an existing one:

```ts
import { defineView } from "../shared/views/builder.ts";

export const myView = defineView().render(function (param: string) {
    return this.response
        .text(this.t("welcome") + param)
        .keyboard(new InlineKeyboard().text("Refresh", "refresh"));
});
```

`render` is derived into context via `defineView.buildRender(context, globalData)` (done once in `src/plugins/index.ts`).
Use it in handlers: `await context.render(myView, param)`.

### Locks (Verrou)

`src/services/locks.ts` exports a `verrou` instance.
Use it to prevent concurrent processing of the same resource:

```ts
await verrou.createLock("user-42", "5 minutes").run(async () => {
    // only one execution at a time per key
});
```

## Useful links

> Any GramIO docs page is also available as clean Markdown by appending `.md` to the URL — fetch those when you need a specific reference instead of the whole `llms-full.txt`.

| Topic | URL |
|-------|-----|
| GramIO docs index (LLM-optimized) | https://gramio.dev/llms.txt |
| Full docs in one file (for context loading) | https://gramio.dev/llms-full.txt |
| Bot context & methods | https://gramio.dev/bot-api.md |
| Keyboards | https://gramio.dev/keyboards/overview.md |
| Formatting helpers | https://gramio.dev/formatting.md |
| Composer (named, scoped, dedup) | https://gramio.dev/extend/composer.md |
| Middleware & production architecture | https://gramio.dev/extend/middleware.md |
| CallbackData (type-safe payloads) | https://gramio.dev/callback-data.md |
| Testing guide | https://gramio.dev/testing.md |
| Views plugin | https://gramio.dev/plugins/official/views.md |
| Verrou (locks) | https://verrou.dev/ |

## Keeping this file up to date

When making changes, update the relevant section above:

| Change | Section to update |
|--------|-------------------|
| New plugin installed | Tech Stack, Architecture |
| New handler added | Project Structure |
| New provider added | Project Structure, Conventions (Providers), Architecture (Providers) |
| New service / external client | Project Structure |
| New env variable | document it in config.ts inline |
| Pipeline / media behavior changed | Architecture (Media pipeline) |
| Script added to package.json | Key Commands |