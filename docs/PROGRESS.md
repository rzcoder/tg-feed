# PROGRESS.md — chapter checklist

Single source of truth for "where are we?". Update this file at the end of every
session: tick the chapter, write a short note, move the `→` marker. The full plan
lives in [PLAN.md](PLAN.md); the dev guide in [AGENTS.md](AGENTS.md).

Legend: `[ ]` not started · `[~]` in progress · `[x]` done

---

## Chapters

- [x] **Chapter 1 — Repo bootstrap** — pnpm workspaces, ESLint flat config, Prettier,
      Vitest, `.editorconfig`, `.gitignore`, `simple-git-hooks` + `lint-staged`. Empty
      workspaces (`apps/server`, `apps/web`, `packages/shared`). Docs (`AGENTS.md`,
      `PLAN.md`, `PROGRESS.md`), `README.md`, `.env.example`.
- [x] **Chapter 2 — DB layer** — `better-sqlite3` + drizzle schema + migrations +
      `apps/server/src/config.ts` (zod env). CRUD smoke tests.
- [x] **Chapter 3 — Telegram client core** — gramjs client from env, `tg:login`
      script, `NewMessage` listener with subscription matcher, startup entity
      resolution. `pino` + `dotenv` landed.
- → [ ] **Chapter 4 — Forwarding pipeline (no filters yet)** — per-destination FIFO,
  throttle, FloodWait handling, `forward_log`.
- [ ] **Chapter 5 — Album / grouped media** — `groupedId` debouncer, batched
      `forwardMessages`.
- [ ] **Chapter 6 — Filter framework** — rule registry + first rules
      (`text-contains`, `text-excludes`, `text-regex`, `has-media`, `min-length`,
      `sender-allowlist`).
- [ ] **Chapter 7 — API server** — Fastify with cookie auth, CRUD for subscriptions /
      filters / settings / log; uses shared zod schemas.
- [ ] **Chapter 8 — Event bus + SSE** — typed event bus, `GET /api/stream` SSE.
- [ ] **Chapter 9 — Web skeleton** — Vite + React + Tailwind + shadcn/ui + Router +
      TanStack Query + auth/login.
- [ ] **Chapter 10 — Web: Subscriptions UI**.
- [ ] **Chapter 11 — Web: Filters UI** — schema-driven form per rule.
- [ ] **Chapter 12 — Web: Settings UI**.
- [ ] **Chapter 13 — Web: Activity feed (SSE)**.
- [ ] **Chapter 14 — Docker + deployment** — multi-stage Dockerfile, compose,
      health endpoint, end-to-end smoke.

---

## Notes by chapter

### Chapter 1 — Repo bootstrap

- Done. Targeted Node ≥ 20 (dev machine on 24.5.0). pnpm 10.30.3.
- Workspaces use `"type": "module"` + NodeNext. `apps/web` is intentionally minimal in
  Chapter 1 (no Vite/React yet — those land in Chapter 9).
- `packages/shared` exposes its source via `exports` (dev consumes `.ts` directly via
  `tsx` and Vite). When `dist/` is built later we may need to switch to a conditional
  exports map, but keep simple until something forces a change.
- `console.log` in `apps/server/src/index.ts` is a placeholder; Chapter 3 swaps it for
  `pino`.
- `tsconfig.base.json` is strict + `noUncheckedIndexedAccess` + `noImplicitOverride`.
  Per-workspace tsconfigs are independent (no composite project refs) — type resolution
  for `@tg-feed/shared` flows through its package `exports` pointing at source `.ts`.
  Revisit if we ever publish `dist/` or hit cross-workspace cycles.

### Chapter 2 — DB layer

- Done. `better-sqlite3@11.10`, `drizzle-orm@0.36`, `drizzle-kit@0.28`, `zod@3.23`.
  `pnpm.onlyBuiltDependencies` allow-lists `better-sqlite3` (and `esbuild`,
  `simple-git-hooks`) so the native build runs on `pnpm install`.
- **Telegram chat / message IDs stored as `text`**, not integer. Lossless, opaque,
  matches how gramjs hands them out (BigInteger → `.toString()`). We never need
  numeric range queries on these.
- **`forward_log.subscriptionId` is nullable + `ON DELETE SET NULL`** — forwarding
  history survives subscription deletion (analytics value). `subscription_filters`
  uses cascade since orphaned filters are dead weight.
- **`forward_log.status` has an explicit CHECK constraint**
  (`'sent' | 'filtered' | 'flood_wait' | 'failed'`) added via drizzle's `check()`
  helper. Drizzle's `text({ enum: [...] })` is TS-only and does NOT generate a CHECK
  on its own — easy to miss.
- **JSON columns** (`subscription_filters.params`, `app_settings.value`) use
  `text({ mode: 'json' })`. `params` is typed `Record<string, unknown>` for now;
  Chapter 6 will narrow to the FilterRuleParams discriminated union from
  `@tg-feed/shared` (type-only change, no migration).
- **Indexes** added now in the initial migration: `idx_forward_log_created_at` (Ch 7
  paginates by createdAt DESC), `idx_forward_log_subscription`,
  `idx_subscription_filters_sub`. Free in the first migration, painful to add
  retroactively.
- **`config.ts` covers all env vars** from `.env.example`, with Chapter 3+ ones
  marked `.optional()`. Tightening to required is a one-line change in the chapter
  that consumes them — much less churn than adding new fields each chapter.
- **`DATABASE_PATH` resolves relative paths against the project root**
  (dir containing `pnpm-workspace.yaml`), so `pnpm db:migrate` produces
  `data/tg-feed.sqlite` at the repo root regardless of cwd. pnpm `--filter` sets
  cwd to `apps/server`, which would otherwise put the DB inside the workspace.
  Helper `resolveDatabasePath` lives in `db/client.ts`.
- **No `app_settings` seed in this chapter.** Chapter 4 owns the `delayMs` default.
  Keeps schema vs data migrations conceptually separate and Ch 2's surface tight.
- **No `dotenv` and no `pino` yet** — Chapter 3 introduces both. `migrate.ts` uses
  `console.log` (same precedent as `index.ts`).
- **`apps/server/drizzle/`** (generated SQL + meta snapshots) is committed and
  added to `.prettierignore`. ESLint already ignores by glob.
- **Tests** are per-test in-memory DBs via `db/testing.ts#createTestDb` —
  sub-millisecond setup, clean slate per test. The CHECK constraint, FK cascades,
  FK set-null, JSON roundtrip, and pragma application are all explicitly asserted.

### Chapter 3 — Telegram client core

- Done. `telegram@2.26` (gramjs), `input@1.0.1`, `pino@9` + `pino-pretty@11`,
  `dotenv@16`. `client.setLogLevel(LogLevel.WARN)` pins gramjs's own logger so it
  doesn't drown the pino output.
- **`dotenv/config` only at entry points** — `index.ts`, `db/migrate.ts`,
  `scripts/tg-login.ts`. Never in `config.ts` itself: `config.ts` is imported by
  Vitest tests, which must not silently pick up the dev `.env`.
- **TG env vars stayed `.optional()` in zod** so `pnpm db:migrate` and
  `pnpm tg:login` (which mints the session string) can run without a session
  string set. Runtime gate is `requireTelegramEnv(config)` in `tg/client.ts`,
  called only from the server boot path.
- **Shutdown order matters.** `client.disconnect() → client.destroy() → closeDb()`.
  `destroy` alone leaves the auto-reconnect loop running and the process won't
  exit cleanly on SIGINT. Encapsulated in `tg/client.ts#disconnectClient`.
- **`StringSession("")`** is the documented "fresh session" sentinel; passing
  `undefined` throws. `tg-login.ts` and `createTelegramClient` both pass
  `sessionString ?? ''` defensively.
- **`MessageMatcher` is split** into a pure `matchSubscription(MatchableEvent, subs)`
  (testable with plain fixtures, no gramjs at the type level) and an adapter
  `extractMatchableEvent(NewMessageEvent)` that handles the `MessageService`
  guard and `BigInteger | undefined` chatId. Tests cover only the pure half;
  the adapter is exercised end-to-end by the listener (live network, untested).
- **Subscription join-by-username deferred to Chapter 10.** PLAN says "join
  channels by username/invite if needed" but the schema has no username/invite
  column yet — that lands with the UI add-flow in Ch 10. Ch 3's
  `resolveSubscriptionsOnStartup` only calls `client.getEntity(sourceChatId)`
  to warm the entity cache and surface stale rows; failures log a warning,
  never throw.
- **Listener re-queries DB per event.** Cheap (in-memory SQLite, indexed) and
  keeps the picture fresh while subs are toggled live from the future UI.
  Revisit if profiling says otherwise.
- **`input@1.0.1` is a CommonJS package** consumed via `import input from 'input'`
  — works under NodeNext + `"type": "module"` because Node's CJS interop maps
  the default export to the module's `module.exports` object.
- **gramjs ships optional native deps** (`bufferutil`, `utf-8-validate`,
  `core-js`, `es5-ext`) whose build scripts pnpm ignores by default. They're
  pure speedups for `ws` and not needed at runtime — the install warning is
  expected; do not allow-list them.

### Chapter 4 — Forwarding pipeline

_(notes to be filled in when work starts)_

### Chapter 5 — Album handling

_(notes to be filled in when work starts)_

### Chapter 6 — Filter framework

_(notes to be filled in when work starts)_

### Chapter 7 — API server

_(notes to be filled in when work starts)_

### Chapter 8 — Event bus + SSE

_(notes to be filled in when work starts)_

### Chapter 9 — Web skeleton

_(notes to be filled in when work starts)_

### Chapter 10 — Web: Subscriptions UI

_(notes to be filled in when work starts)_

### Chapter 11 — Web: Filters UI

_(notes to be filled in when work starts)_

### Chapter 12 — Web: Settings UI

_(notes to be filled in when work starts)_

### Chapter 13 — Web: Activity feed

_(notes to be filled in when work starts)_

### Chapter 14 — Docker + deployment

_(notes to be filled in when work starts)_
