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
- [x] **Chapter 4 — Forwarding pipeline (no filters yet)** — per-destination FIFO
      with one worker per destination chat, throttle from `app_settings`,
      FloodWait detection + retry, `forward_log` row per attempt.
- [x] **Chapter 5 — Album / grouped media** — `groupedId` debouncer keyed by
      `${sourceChatId}:${groupedId}` with a 2 s window, batched into one
      `forwardMessages` call. `ForwardJob.sourceMessageId` lifted to
      `sourceMessageIds: string[]`; new `RawForwardJob` carries the optional
      `groupedId` from listener to debouncer.
- → [ ] **Chapter 6 — Filter framework** — rule registry + first rules
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

- Done. New module `apps/server/src/forwarding/` with `types.ts`, `throttle.ts`,
  `floodwait.ts`, `forwarder.ts`, `queue.ts`, `index.ts` (factory). Listener
  signature gained a `forwarding: ForwardingHandle` parameter; `index.ts` builds
  the pipeline alongside the DB and stops it before disconnecting the client.
- **Worker-per-destination, not per-subscription.** Telegram throttles per
  receiving chat, so the throttling domain is the destination. Two subs sharing
  one destination share its FIFO and delay; two subs with different destinations
  drain in parallel. Workers are lazy-created on first enqueue and live for the
  pipeline's lifetime.
- **Discriminated `ForwardOutcome` instead of throwing.** The forwarder owns the
  one place where `forward_log` rows are written, and returns
  `{ status: 'sent' | 'flood_wait' | 'failed', ... }`. The worker switches on
  `status` — no error classification in the loop, and tests assert on the union
  directly. FloodWait detection lives in `floodwait.ts` with a structural
  fallback (matches by `constructor.name === 'FloodWaitError'` + numeric
  `seconds`) for resilience against gramjs cross-realm error instances.
- **Throttle default: 8 s.** Lives as `DEFAULT_DELAY_MS` in `throttle.ts`, mid
  of the PLAN's 5–15 s band. `getGlobalDelayMs(db)` reads the
  `app_settings.value.delayMs` row keyed `'global'`; missing row, missing
  field, or non-positive number all silently fall back to the default — a
  malformed settings row must never trip Telegram's anti-spam by disabling the
  throttle. No seed row written this chapter; first write happens via the
  Settings UI in Ch 12 (or earlier via API in Ch 7).
- **`flood_wait` retry semantics.** On `FloodWaitError`: write a log row with
  status `flood_wait`, sleep `seconds * 1000` ms, retry the **same** job (do
  not pop from the queue). The CHECK constraint on `forward_log.status` was
  pre-built in Ch 2 with `'flood_wait'` baked in, so no schema change needed.
  No retry cap — Telegram bounds `seconds` itself, and personal use doesn't
  warrant a circuit breaker.
- **`DESTINATION_CHAT_ID` env still unused.** Subscriptions carry their own
  `destinationChatId` (notNull) so the env is dead weight for now. Leave it in
  `.env.example` and `config.ts` as a future default for the Subscriptions UI
  add-flow (Ch 10) — easier than re-introducing it later.
- **Cancellable sleep + AbortController.** Worker sleeps (both throttle and
  flood-wait) take an `AbortSignal`. `pipeline.stop()` aborts; sleeps resolve
  immediately, the loop checks `signal.aborted` after every wait, then exits.
  Same `AbortSignal` is shared across all workers. An in-flight `forwarder()`
  call is awaited to completion (one max trailing send) — gramjs has no
  abort hook anyway.
- **Test patterns.** `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(ms)`
  drives the worker through throttle and flood-wait sleeps; the test injects a
  `SleepFn` built on `setTimeout` so fake timers control it. The forwarder
  test seeds a real subscription row in an in-memory DB and asserts on
  `forward_log` rows by status. The flood-wait type-guard test uses a class
  expression (not a class declaration) for the synthetic `FloodWaitError` —
  vitest's transform was renaming declared classes (`FloodWaitError2`), which
  broke the structural `constructor.name` check.

### Chapter 5 — Album handling

- Done. New module `apps/server/src/forwarding/albumDebouncer.ts` sits between
  the listener and the existing `ForwardingPipeline`. Wiring in `index.ts` is
  one line: `const debouncer = createAlbumDebouncer({ downstream: pipeline, logger })`,
  then the listener takes the debouncer instead of the pipeline. Shutdown
  order: `debouncer.stop(); await pipeline.stop(); await disconnectClient(client)`.
- **Two job shapes, not one with optional fields.** `RawForwardJob` (listener →
  debouncer) carries an optional `groupedId` and a singular `sourceMessageId`.
  `ForwardJob` (debouncer → pipeline) drops `groupedId` and uses
  `sourceMessageIds: string[]`. After debouncing the grouping work is done —
  putting `groupedId` on `ForwardJob` would be a stale field the pipeline
  never reads. Cost: one extra type and one shape transform in the debouncer;
  benefit: each contract says exactly what it means.
- **`sourceMessageId` rename was the bigger ripple.** Lifted singular →
  `sourceMessageIds: string[]` everywhere (`types.ts`, `forwarder.ts`,
  `queue.test.ts`, `forwarder.test.ts`). The forwarder already called
  `client.forwardMessages` with a 1-element array internally, so the runtime
  shape was already arrayed — the rename just lifts that into the type.
  Considered an optional parallel field instead but rejected: every consumer
  would have to branch on which shape was present.
- **Window key: `${sourceChatId}:${groupedId}`.** gramjs `groupedId` is per
  account, not per chat; same numeric id appearing in two source chats inside
  the 2 s window is unlikely but cheap to defuse. Both halves are numeric
  strings so `:` is unambiguous.
- **`ALBUM_DEBOUNCE_MS = 2000`** as a module constant, mirroring the
  `DEFAULT_DELAY_MS` precedent in `throttle.ts`. No `app_settings` row this
  chapter — PLAN says fixed 2 s, and YAGNI for personal use. Override hook
  (`windowMs` ctor option) exists for tests.
- **Per-group `setTimeout`, no abstraction over it.** Bounded by concurrent
  in-flight albums (a handful at most). The `SleepFn` injection in
  `queue.ts:22` only exists because `cancellableSleep` returns a Promise;
  the debouncer just calls `setTimeout` directly and `vi.useFakeTimers()` in
  tests controls it without ceremony.
- **On flush: dedupe via `Set`, sort numerically ascending.** Telegram orders
  album items by message id; an out-of-order array passed to
  `forwardMessages` can break album grouping in the destination. Arrival
  order is _usually_ ascending under normal conditions but not guaranteed
  under bursts.
- **`stop()` drops pending groups, doesn't flush them.** Matches the queue's
  ignore-after-stop behavior. Lost album members at shutdown are no different
  from any other miss while offline — the listener doesn't persist incoming
  messages anywhere.
- **`forward_log`: one row per source id**, paired by index with the
  `forwardMessages` return array. Schema unchanged. For an album of 3, that's
  3 `'sent'` rows each with their own `destMessageId` (gramjs preserves
  order). Error paths (`flood_wait`, `failed`) also write one row per source
  id with `destMessageId = null` — preserves the per-source audit trail
  whether or not we got dest ids back.
- **`MatchableEvent` gained `groupedId?: string`**, extracted in
  `extractMatchableEvent` via `message.groupedId?.toString()`. Per Ch 3
  precedent the adapter half is exercised end-to-end by the listener (no
  unit test) — only the pure `matchSubscription` is covered directly.
- **Tests cover the contract, not the timer mechanics.** Six tests in
  `albumDebouncer.test.ts`: pass-through for ungrouped, buffering + sort on
  flush, no conflation across `sourceChatId`, straggler treated as new group,
  dedupe within a group, stop drops pending. New album-shape test in
  `forwarder.test.ts` asserts one `forwardMessages` call + N log rows for an
  N-element source id list.

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
