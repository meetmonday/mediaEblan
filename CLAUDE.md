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
│   ├── guest.ts        # Bot API 10 guest_message → answerGuestQuery (one result)
│   ├── inline.ts       # inline routing only; result building lives in media/inline.ts
│   └── start.ts        # /start, deep-link tokens (pendingLinks) → sendMedia
├── providers/          # Media source adapters — one module (folder) per site
│   ├── types.ts        # Provider, ProviderResult, DirectMediaResult, MediaItem/Metadata
│   ├── errors.ts       # ProviderError / HttpError / NetworkError hierarchy
│   ├── helpers.ts      # extensionOf, makeAuthor, epochToIso, kindFromPath, mediaSources, downloadMediaSources
│   ├── http.ts         # fetchWithTimeout, fetchJson, downloadTo, fetchRedirect
│   ├── registry.ts     # providers[], resolveProvider, findMediaUrl, supported sites
│   ├── twitter|tiktok|pixiv.ts             # site adapters (on helpers)
│   ├── reddit/         # index.ts (provider) + post.ts (parse/API/metadata) + media.ts (images) + video.ts (DASH audio)
│   └── trashbox/       # index.ts (provider, commentResult) + comment.ts (URL/HTML domain)
├── media/              # Media delivery pipeline + presentation
│   ├── pipeline.ts     # processMedia: lock → cache → fetch+retry → compress → send
│   ├── sender.ts       # senderFrom — adapts a GramIO context to MediaSender
│   ├── caption.ts      # CaptionBuilder / captionFor / cachedCaption / textResultCaption
│   ├── inline.ts       # inline results: directResults / cachedResults / textResults
│   ├── query.ts        # resolveQuery (shared by inline + guest) / openBotResult
│   └── cache.ts        # URL → file_id cache (bounded store)
├── services/           # Cross-cutting infrastructure (no domain imports)
│   ├── locks.ts        # Verrou locker (per-resource mutex)
│   ├── proc.ts         # runBinary — spawn + stderr parsing (yt-dlp, ffmpeg)
│   ├── ffmpeg.ts       # muxAudio, compressVideo, fileSize (wraps proc.ts)
│   ├── bounded-store.ts# insertion-ordered map with a size limit
│   └── pending-links.ts# short-lived tokens for the inline fallback button
└── shared/
    ├── keyboards/      # Reusable Keyboard / InlineKeyboard builders
    └── views/          # defineView (initViewsBuilder) — re-renderable components
```

### Layering (load-bearing)

A module may import only from the layers **to its left**:

```
shared/  →  services/  →  providers/  →  media/  →  handlers/
```

- `services/` is infrastructure: it must not import from `providers/` or `media/`.
- `providers/` return **data** (`ProviderResult`) and never render Telegram text — caption/article/message rendering belongs to `media/`. That's why the Trashbox provider returns `text.content` (the body only) and the pipeline builds the metadata and source-link lines around it.
- `media/` owns every GramIO-specific rendering decision (captions, inline keyboards, uploads).

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
  - `tests/trashbox-unit.test.ts` — Trashbox pure functions (`htmlCleaner`, `commentMediaSources`, `firstImgSrc`) + the comment-result contract
  - `tests/http.test.ts` — `fetchWithTimeout` transport behavior (timeout, socket close)
  - `tests/bounded-store.test.ts` — the shared bounded store + `pendingLinks` tokens
  - `tests/flow.test.ts` — full bot flow via `TelegramTestEnvironment` with a fake provider (chat/inline/photo/video/multi/text/error/retry)
- `tests/guest.test.ts` — guest mode: synthetic `guest_message` updates through `env.emitUpdate`, asserting `answerGuestQuery` (cached result, first-of-album, hand-off article, hint article, missing `guest_query_id`)
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
- **Use the shared helpers** (`providers/helpers.ts`): `extensionOf` (extension from a URL), `makeAuthor` (author object), `epochToIso` (unix → ISO — **always** normalize dates at the provider boundary), `kindFromPath`/forced `kind`, `mediaSources(prefix, urls, kind?)` (batch of `MediaSource` named `<prefix>_<index>`) and `downloadMediaSources(sources, dir, { sequential, headers, kind })` which cleans up partial downloads on failure. Pixiv must pass `sequential: true` — i.pximg.net throttles parallel connections.
- **Parse once**: each provider exports `parse(url): { id } | null` and reuses it in `match`, `fetch`, and `resolveDirect` instead of re-extracting the id.
- **Network calls** go through `providers/http.ts` (`fetchJson`, `fetchWithTimeout`, `downloadTo`, `fetchRedirect`) — they already wrap failures as `HttpError`/`NetworkError`. The error classes themselves live in `providers/errors.ts` and are imported from there everywhere.
- **Text-only results** (e.g. a comment without images) are returned as `ProviderResult.text: { content, disableLinkPreview, sourceUrl, title? }` with `items: []`. The provider returns the **body only** — the pipeline renders metadata + source link around it (`textResultCaption`), chat mode appends the link as a `🔗 url` line, deep-link/inline mode drops it and attaches the buttons. They are sent via `sendText`, not treated as errors.
- **Providers return data, never rendered text** — see [Layering](#layering-load-bearing).

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
5. **Text branch** — `result.items` empty with `result.text` → `sender.sendText(textResultCaption(result, { includeSourceLink }), { disableLinkPreview }, keyboard)`; nothing is cached. The provider supplies the body only; the pipeline wraps it in the standard metadata block and appends the `🔗 url` line in chat mode, or drops the line when `withSourceButtons` is set.
6. **Send** — videos above `MAX_FILE_SIZE_MB` are compressed via ffmpeg (`prepareItem`); single item → `sendPhoto`/`sendVideo` (`sendSingle`, caches the `file_id`), several → `sendMediaGroup` (`sendAlbum`, caption on the first item). Downloaded files are always removed in a `finally` (`cleanup`).
7. **Source buttons** — with `withSourceButtons` (deep-link flow + inline results) the `🔗 url` caption line is dropped and replaced by two URL buttons (`sourceButtons` in `shared/keyboards/index.ts`): «Открыть» opens the source, «Поделиться» opens `t.me/share/url`. Albums can't carry inline keyboards — `senderFrom` sends the buttons in a follow-up message (zero-width-space text).

`MediaSender` is a minimal interface (defined in `pipeline.ts`) so tests can inject a fake; each send method takes an optional `InlineKeyboard`. `senderFrom(context)` in `media/sender.ts` adapts a GramIO context.

### Captions

`media/caption.ts` owns every caption line. `CaptionBuilder` assembles them; `captionFor(metadata, params)` produces the standard layout, and `params` (`CaptionParams`) is an **object, never a positional boolean**:

```ts
captionFor(metadata, { options, sourceUrl, includeSourceLink })
```

- `options` — the provider's `CaptionOptions` (stat order, extra lines, rich `content`, its own `sourceLink`);
- `sourceUrl` — fallback link when the provider didn't set one;
- `includeSourceLink: false` — drop the `🔗` line entirely (buttons carry the source).

`cachedCaption(entry, { sourceUrl, includeSourceLink })` rebuilds a caption from a cache entry (its stored `caption` options are reused), and `textResultCaption(result, params)` renders the text-only branch. Inline results are built in `media/inline.ts` (`directResults`, `cachedResults`, `textResults`) — all three pin the source buttons and suppress the `🔗` line.

### Query resolution (shared by inline and guest)

`media/query.ts` owns `resolveQuery(query) → { results, fallbackUrl? }`: a Trashbox comment becomes a text article, otherwise an already-sent `file_id` is reused (`mediaCache`), otherwise the provider's `resolveDirect` URLs are addressed. **Nothing is ever downloaded** — anything that would need a download returns no results plus a `fallbackUrl`, so both consumers can offer the bot instead of failing silently.

### Guest mode (Bot API 10)

`handlers/guest.ts` handles the `guest_message` update — a link sent in a chat the bot **isn't a member of**. Two consequences shape the whole flow:

- The bot can't `sendPhoto`/`reply` there. The only way to answer is `ctx.answerGuestQuery(result)`, which takes **exactly one** `InlineQueryResult` that the caller then sends itself. So the handler reuses `resolveQuery` and sends `results[0]`; an album degrades to its first item.
- An article carries no `start_parameter` button (that field exists only on `answerInlineQuery`), so the hand-off rides on the article's `url` — `openBotResult` builds `t.me/<bot>?start=<pendingLinks token>`, which `/start` consumes exactly like the inline fallback.

`GUEST_MODE` (default on) gates the flow; without it — or without a `guest_query_id` — the bot stays silent. The guest handler **never** calls the download pipeline, and provider failures degrade to the hand-off rather than throwing.

### Providers

`src/providers/` adapts each site to the uniform `Provider` interface (`types.ts`). Chat mode uses `fetch(url, downloadDir)` which downloads media; inline mode uses the optional `resolveDirect(url)` which returns publicly-embeddable URLs without downloading.

Two providers are folders, because one file grew past what fits on a screen:

- `providers/reddit/` — `index.ts` (the `Provider`), `post.ts` (URL parsing, share-link redirects, API + mirror, metadata), `media.ts` (gallery / single image), `video.ts` (DASH audio discovery and muxing).
- `providers/trashbox/` — `index.ts` (the `Provider` + `commentResult`/`resolveComment`, shared with the inline handler) and `comment.ts` (URL/HTML domain).

**Fallback sources and the retry contract** — a provider that tries several sources must not turn a dead source into a dead end. An HTTP answer the source doesn't like (403 for a blocked IP, 404 for a deleted post) means "ask the next source"; a transport failure (`NetworkError`: timeout, reset) is remembered and rethrown only when *every* source failed, so the pipeline's single retry still applies. Only when all sources answered without a usable post do you throw a `ProviderError` (see `fetchPostData` in `reddit/post.ts`).

**Adding a new provider** — the whole point of the refactor, no copy-paste:

1. Create `src/providers/<name>.ts` (or a `<name>/` folder when it needs more than one concern):
   - `match(url)` — decides whether the URL belongs to this provider (usually via an exported `parse`)
   - `fetch(url, downloadDir)` — returns `ProviderResult`; download via `downloadMediaSources` + `mediaSources`
   - `resolveDirect?(url)` — only when there are public URLs for inline mode
   - errors: `throw new ProviderError("<name>", "текст")` for semantic problems, or let the http helpers raise `HttpError`/`NetworkError`
   - never import from `media/` (or any presentation layer) — a provider returns data, see [Layering](#layering-load-bearing)
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

`src/services/locks.ts` exports a `verrou` instance backed by the in-memory driver (single process — swap in a Redis driver there to run several instances).
Use it to prevent concurrent processing of the same resource:

```ts
await verrou.createLock("user-42", "5 minutes").run(async () => {
    // only one execution at a time per key
});
```

### Bounded stores

`src/services/bounded-store.ts` provides the insertion-ordered, size-limited map behind both the file_id cache (`media/cache.ts`) and `pendingLinks`. Adding a key at the limit drops the oldest one; overwriting an existing key never evicts. Use it instead of a bare `Map` for anything user-visible that can grow unbounded.

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
| New service / external client | Project Structure, Layering |
| New env variable | document it in config.ts inline |
| Pipeline / media behavior changed | Architecture (Media pipeline), Architecture (Captions) |
| A module now imports another layer | Layering |
| Script added to package.json | Key Commands |