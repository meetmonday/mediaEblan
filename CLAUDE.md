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

Before writing or modifying any code that imports `gramio` or `@gramio/*`, or touches files under `src/handlers/`, `src/commands/`, `src/scenes/`, `src/plugins/`, `src/shared/` — **invoke the `gramio` skill via the Skill tool first**. Do not rely on training-data knowledge of the framework: APIs shift fast, and the skill is the single source of truth for current patterns.

## Tech Stack

- **Framework**: [GramIO](https://gramio.dev/)
- **Linter**: Biome
- **Plugins**: Auto answer callback query, Auto-retry, Views, Media-group, Media-cache
- **Other tools**: Jobify

## Project Structure

```
src/
├── index.ts          # Entry point — starts the bot, graceful shutdown
├── bot.ts            # Bot instance with plugin chain
├── config.ts         # Typed environment variables (env-var)
├── plugins/
│   └── index.ts      # Shared Composer — extend this in every handler for typing
├── handlers/         # Command/event composers (each extends shared composer)
├── shared/
│   ├── keyboards/    # Reusable Keyboard / InlineKeyboard builders
│   └── callback-data/ # CallbackData class definitions
│   └── views/        # Re-renderable message components (defineView)
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

- `bun test` — fast flow tests in `tests/flow.test.ts`: chat/inline/photo/video/multi/error flows through the real bot with a **mocked** provider. No network.
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

`src/services/locks.ts` exports a `locker` instance.
Use it to prevent concurrent processing of the same resource:

```ts
await locker.createLock("user-42").run(async () => {
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
| New service / external client | Project Structure |
| New env variable | document it in config.ts inline |
| Script added to package.json | Key Commands |