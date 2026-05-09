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
- [x] **Chapter 6 — Filter framework** — `@tg-feed/shared` rule type defs +
      zod schemas for the six v1 rules (`text-contains`, `text-excludes`,
      `text-regex`, `has-media`, `min-length`, `sender-allowlist`); factory
      registry + per-rule files + evaluator in `apps/server/src/filters/`.
      Filter eval lives at the album-debouncer flush/pass-through boundary
      so albums pass or fail as a unit (against the caption-bearing
      member's content). Skipped messages get one `forward_log` row per
      source id (`status='filtered'`, joined reasons in `error`). Schema
      types narrowed to `FilterRuleType` / `AnyFilterRuleParams` (TS-only,
      no migration).
- [x] **Chapter 7 — API server** — Fastify with single-user signed-cookie auth.
      `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/me`; CRUD for
      `/api/subscriptions`, per-sub filters at `/api/subscriptions/:id/filters`
      with a discriminated-union request schema, `GET /api/filters/catalog` from
      the live registry, `GET/PUT /api/settings`, paginated `GET /api/forward-log`.
      `requireWebAuthEnv` parallels `requireTelegramEnv`. `FORWARD_LOG_STATUSES`
      moved to `@tg-feed/shared`. Error handler maps `ZodError` and `AppError`
      subclasses (`UnauthorizedError`/`NotFoundError`/`ValidationError`/`ConflictError`
      from new `lib/errors.ts`) to `{ error: { code, message, issues? } }`. 102 new
      tests; 238 total.
- [x] **Chapter 8 — Event bus + SSE** — `Set`-backed `EventBus` with bus-stamped
      `occurredAt`, threaded through forwarder / filter evaluator / subscription
      routes; new `GET /api/stream` SSE route in the authed scope using
      `reply.hijack()` + raw socket writes, 25 s heartbeat (override-able for
      tests). 15 new tests; 253 total.
- → [ ] **Chapter 9 — Web skeleton** — Vite + React + Tailwind + shadcn/ui + Router +
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

- Done. New module `apps/server/src/filters/` with `types.ts`, `registry.ts`,
  `evaluate.ts`, `index.ts` (barrel), and `rules/{textContains,textExcludes,
textRegex,hasMedia,minLength,senderAllowlist}.ts` plus
  `rules/index.ts#createDefaultRegistry()`. Shared package gains
  `packages/shared/src/filters.ts` with the rule type tuple, per-rule zod
  schemas, the `filterRuleParamsSchemas` map, and the `AnyFilterRuleParams`
  union; re-exported through `packages/shared/src/index.ts`. zod added as a
  direct dep on `packages/shared/package.json` (was a transitive on the
  server side; pinned to the same `^3.23.8`).
- **Filter eval lives at the album debouncer, not the listener.** Telegram
  albums put the caption on a single member only — the rest arrive with empty
  text. Per-message text filtering would silently fragment albums (one
  member passes, the rest fail) and worse: `text-excludes` would let the
  un-captioned members of a spam-captioned album through. Filter eval at the
  debouncer's pass-through (ungrouped) and flush (grouped) paths runs once
  per album against the caption-bearing member, so the group passes or fails
  atomically. `pickCaptionBearingMember` picks the longest-text job, ties
  broken by lowest `sourceMessageId` — robust against arrival-order bursts.
- **`RawForwardJob` grew `text`, `hasMedia`, `senderUsername?`.**
  `MatchableEvent` got the same fields. `ForwardJob` (post-debounce) is
  unchanged — the pipeline forwards by id and doesn't read content. The
  listener pulls these straight from `extractMatchableEvent` and threads
  them into `forwarding.enqueue`. `MessageContext` (in `filters/types.ts`)
  is the structural subset the evaluator consumes — `MatchableEvent` and
  `RawForwardJob` both satisfy it without explicit adapter code.
- **Two rule shapes: `FilterRule<T>` (typed) and `RegisteredFilterRule`
  (type-erased).** zod's `.default(...)` makes the schema's Input type wider
  than its Output, so `paramsSchema: z.ZodType<FilterRuleParamsFor<T>>` won't
  accept a real `z.object({...}).default(...)` schema. Workaround:
  `paramsSchema: z.ZodTypeAny` on the rule shape (each rule still references
  its concrete schema at the declaration site). The registry stores
  `RegisteredFilterRule` whose `evaluate(ctx, params: unknown)` matches the
  evaluator's call site (params come from a JSON column and are validated
  by the rule's own schema before evaluate is invoked). The cast happens
  once, at `register`.
- **Fail-OPEN on broken filter rows** — unknown `ruleType`, zod parse
  failure on `params`, or a runtime throw inside `rule.evaluate` causes the
  evaluator to log a warning and skip that single row. Other rules still
  gate the message. Per the user's choice on the planning question: a
  misconfigured single rule shouldn't gate the whole subscription. If ALL
  rules fail open the empty-set result is `pass: true` (vacuous AND). The
  one `try/catch` lives in `evaluateFilters` — rules don't self-handle.
  `text-regex` is the rule most likely to throw (`SyntaxError` on a bad
  pattern); its rule test confirms the throw propagates instead of being
  swallowed inside the rule.
- **Evaluator queries with `ORDER BY id ASC`** so reasons accumulate in
  insertion order. Without this, SQLite's row order is implementation-
  defined and the joined `error` text would be non-deterministic for tests
  and the future Activity UI.
- **`forward_log` write convention preserved.** One row per source id, same
  as Ch 4/5. For an album-wide rejection that's N rows with identical
  `subscriptionId`, `status='filtered'`, `error=reasons.join('; ')`,
  `destMessageId=null`. The evaluator owns this side effect; the debouncer
  doesn't touch the DB. Reason format is `"<ruleType>: <short reason>"` —
  no excerpts of the offending message text (deterministic, no PII leakage,
  predictable widths for any future UI).
- **Schema narrowing was TS-only.** Changed `subscriptionFilters.ruleType`
  to `.$type<FilterRuleType>()` and `params` to `.$type<AnyFilterRuleParams>()`.
  `pnpm db:generate` reports "no schema changes" — drizzle's `.$type<>()` is
  a compile-time assertion only. `schema.test.ts` had to swap its fictional
  filter shapes (`{keyword,count}`, `{value: true}`, etc.) for real ones
  from the new union; the FK-violation test changed `ruleType: 'noop'` to
  `'has-media'` since FilterRuleType is now a literal union.
- **Factory registry, not module-import side effects.** `createRegistry()`
  returns a fresh empty registry; `createDefaultRegistry()` builds one and
  registers all 6 v1 rules. Server boot calls the latter once. AGENTS.md
  convention #4 was updated to reflect the new "drop file + add a
  `register(...)` line in `rules/index.ts`" workflow (PLAN.md's earlier
  "self-register on import" wording is the historical record). PLAN.md
  isn't edited.
- **Sender extraction is best-effort.** `extractMatchableEvent` reads
  `message.sender?.username` (lowercased). For most public broadcast
  channels the sender is the channel itself with no `username` exposed
  per-message, so `senderUsername` is undefined and `sender-allowlist`
  fails-with-a-specific-reason (`"no sender info on message"`) — the
  reason text deliberately differentiates "broadcast channel, can't
  apply" from "user not in allowlist." The Ch 3 precedent ("adapter half
  is exercised live, untested") is broken here: sender extraction is
  non-trivial enough to warrant unit tests — `messageMatcher.test.ts`
  gained an `extractMatchableEvent` block covering text, media, groupedId,
  and sender extraction.
- **Tests:** 62 new tests in this chapter — 20 in
  `packages/shared/src/filters.test.ts` (per-rule zod accept/reject), 6 in
  `registry.test.ts`, 4 each in the six rule files, 12 in
  `evaluate.test.ts` (pure helper + DB-integration cases), plus 4 new
  filter-integration tests in `albumDebouncer.test.ts` and 8 new
  `extractMatchableEvent` tests in `messageMatcher.test.ts`. Total repo
  test count: 136. Patterns reused: `createTestDb()` for in-memory DB,
  `createLogger({silent:true})` for noiseless tests, fake timers + capturing
  downstream for the debouncer.

### Chapter 7 — API server

- Done. New module `apps/server/src/api/` with `server.ts` (Fastify factory),
  `auth.ts` (env helper + cookie helpers + `requireAuth` preHandler),
  `errorHandler.ts`, `testing.ts` (`buildTestApp` + `loginAndGetCookie`
  helper), and `routes/{auth,subscriptions,filters,settings,forwardLog}.ts`.
  `apps/server/src/lib/errors.ts` lands the typed `AppError` hierarchy that
  AGENTS.md #9 has been promising since Ch 1. 102 new tests; total 238.
- **`requireWebAuthEnv` mirrors `requireTelegramEnv` from `tg/client.ts`.**
  `WEB_PASSWORD` and `SESSION_SECRET` stay `.optional()` in `config.ts` so
  `pnpm db:migrate` and `pnpm tg:login` keep working without them — only
  the boot path in `index.ts` calls the require helper. Same precedent
  Ch 3 set for Telegram env.
- **`FORWARD_LOG_STATUSES` moved to `@tg-feed/shared`** (`packages/shared/src/forwardLog.ts`).
  The wire DTO and the drizzle schema now refer to the same literal tuple
  through `@tg-feed/shared`; `db/schema.ts` re-exports it for internal
  callers that imported from the schema module pre-move. The CHECK-constraint
  literal in the schema is still inline SQL (drizzle's `text({ enum: ... })`
  is TS-only) — keep updates in lockstep with the tuple.
- **Auth: signed cookie, value `'1'`.** `verifyPassword` runs both inputs
  through SHA-256 then `timingSafeEqual` — fixed-size digests dodge the
  length-mismatch throw (which is itself a side channel) AND mask password
  length from timing observation in one go. Cookie name `tg_feed_session`,
  attrs `httpOnly + sameSite=lax + secure(if prod) + 30 day maxAge`.
  Cleared cookie sent on logout omits `signed: true` because clearing
  doesn't need a signature.
- **Fastify encapsulation gives auth scoping for free.** Public scope =
  `POST /api/auth/login` only. Authed scope =
  `addHook('preHandler', requireAuth)` then everything else. No per-route
  opt-in to forget. Both scopes use `prefix: '/api'`.
- **`@fastify/static` registered unconditionally** pointing at
  `apps/web/dist`. The plugin requires the directory to exist, so the
  factory does `mkdirSync(WEB_DIST_ROOT, { recursive: true })` before
  registration — until Ch 9/14 builds a real SPA the directory just
  stays empty and every non-API path 404s. Decision made deliberately
  (PLAN.md Ch 7 lists the plugin) rather than deferring; cleaner than
  guarding the registration.
- **CORS only in non-production.** `@fastify/cors` registered with
  `origin: ['http://localhost:5173']` and `credentials: true` (Vite needs
  the credentials for the cookie to round-trip). Production is same-origin
  via the static plugin — registering CORS would only widen the attack
  surface.
- **Shared API DTOs** live in `packages/shared/src/api.ts` and re-export
  through the package barrel. `subscriptionDtoSchema.createdAt` is
  `z.string()` (ISO at the wire); the server `.toISOString()`s before
  returning. `forwardLogQuerySchema` uses `z.coerce` so query strings
  parse, with `limit` clamped 1–200 and a `FORWARD_LOG_LIMIT_DEFAULT`
  constant for the web client to default to.
- **Discriminated union for filter create.** `createSubscriptionFilterRequestSchema`
  is `z.discriminatedUnion('ruleType', [...])` with one variant per rule
  pulling its `paramsSchema` from `@tg-feed/shared`'s `filterRuleParamsSchemas`.
  Variants are hand-listed (not mapped from `FILTER_RULE_TYPES`) because
  zod's discriminated-union signature wants a literal-typed tuple. PATCH
  body keeps `params` loose (`z.record`) and the route handler validates
  it against the existing row's `ruleType` — rule type itself is
  immutable post-creation (delete + re-add to switch).
- **PATCH bodies hand-written, never `.partial()` of create.** Mitigation
  for the Ch 6 zod default-value landmine (Input ≠ Output divergence
  silently lost by `.partial()`). Both subscription and filter PATCH
  schemas `.refine` away the empty body so callers can't no-op.
- **Cross-sub filter access returns 404.** `findFilter(db, subId, filterId)`
  ANDs both ids in the WHERE clause; the route never reveals whether the
  filter id exists under a different sub. Prevents id-guessing across
  subscriptions.
- **Settings hide multi-key abstraction.** Wire shape is flat
  `{ delayMs }`; internally writes to row keyed `'global'` with value
  `{ delayMs }`, mirroring `getGlobalDelayMs`'s defensive read. GET
  never 404s — falls back to `DEFAULT_DELAY_MS` (8 s). The settings
  route imports `DEFAULT_DELAY_MS`/`GLOBAL_SETTINGS_KEY`/`getGlobalDelayMs`
  from `forwarding/throttle.ts` so there's exactly one defaulting code
  path; the integration test asserts that PUT visibly affects the
  pipeline's view of the delay.
- **Forward log: `LEFT JOIN subscriptions` + `desc(createdAt), desc(id)`.**
  FK is `ON DELETE SET NULL` (Ch 2), so historical rows for deleted subs
  must surface with `subscriptionTitle: null` rather than disappear from
  an INNER JOIN. Tiebreaker `desc(id)` keeps pagination deterministic
  for albums (N rows in one transaction share `createdAt` ms). Pagination
  uses `limit + 1` trick to compute `nextOffset` without a `COUNT(*)`.
- **Error handler maps `ZodError` and `AppError` subclasses** to
  `{ error: { code, message, issues? } }` from
  `errorResponseSchema` in shared. Anything else → 500 with generic
  `internal` message; original error logged via `request.log.error({ err })`
  but never echoed (no leaking of internals like DB connection strings).
- **Test scaffolding pattern: `buildTestApp()`** in `api/testing.ts`.
  Builds an isolated app with in-memory DB and fixed test webAuth, plus
  `loginAndGetCookie()` that does a real login and returns the
  `Set-Cookie` value (clients echo only `name=value`, not the attrs). All
  route tests use this, so cookie signing roundtrips through the same
  secret; tests can't fabricate signed cookies otherwise.
- **Shutdown order changed:** `app.close() → debouncer.stop() → pipeline.stop()
→ disconnectClient(client) → closeDb()`. HTTP closes first so no new
  requests land while downstream layers are torn down.
- **Tests:** 102 new — 27 in `packages/shared/src/api.test.ts` (DTO
  accept/reject, discriminated union, default propagation, query
  coercion), 14 in `auth.test.ts` (env helper + verifyPassword), 9 in
  `errorHandler.test.ts` (each branch + Fastify-injected through real
  app), 4 in `server.test.ts` (smoke + cookie roundtrip + tampered
  cookie), 8 in `routes/auth.test.ts`, 14 in `routes/subscriptions.test.ts`,
  14 in `routes/filters.test.ts`, 9 in `routes/settings.test.ts`, 8 in
  `routes/forwardLog.test.ts`.

### Chapter 8 — Event bus + SSE

- Done. New module `apps/server/src/events/bus.ts` (singleton-via-DI, not
  module-global) plus shared event taxonomy at
  `packages/shared/src/events.ts`. Bus emit + listener wired into
  `forwarder.ts` (`forward.started`/`completed`/`failed`/`flood_wait`),
  `filters/evaluate.ts` (`forward.filtered`), and the subscription route
  handlers (`subscription.changed`). The SSE consumer is a new authed
  route `apps/server/src/api/routes/stream.ts`. 15 new tests; 253 total.
- **`Set<Listener>` instead of `node:events.EventEmitter`.** `EventEmitter.emit`
  rethrows synchronously when a listener throws, which would propagate a
  buggy SSE write up into a forwarding-pipeline call site. The `Set`-based
  bus catches per-listener errors, logs via the injected logger, and keeps
  going — the forwarder/evaluator never see an error from `bus.emit`.
  `listenerCount()` becomes `set.size` — used by the SSE cleanup test to
  verify unsubscribe ran on disconnect. Iteration snapshots the set
  (`[...listeners]`) so a self-unsubscribing listener doesn't mutate the
  iterator mid-loop (covered by a dedicated test).
- **Bus stamps `occurredAt`, not producers.** Single point of timestamping
  = single thing to mock in tests. Producers emit a `StreamEventInput`
  (no timestamp); the bus produces a `StreamEvent` (with `occurredAt`
  ISO). The shared types define the input union directly with per-variant
  fields next to the discriminator tag — `Omit<Union, 'occurredAt'>`
  doesn't always preserve discriminated-union narrowing, so co-locating
  is more robust.
- **`forward.filtered` added even though PLAN.md doesn't list it.** PLAN.md
  says "Forwarder + filter evaluator emit events" — listing two emitters
  is the explicit license. The event peers `forward_log.status='filtered'`
  from Ch 6 so the Ch 13 Activity feed can render filtered messages
  alongside forwarded ones (same wire-format symmetry). Carries
  `reasons: string[]` (un-joined) — the `forward_log.error` joining is a
  log artifact, not a wire concern.
- **`subscription.changed` does NOT fire for filter mutations.** PLAN.md
  narrows to subscription mutations; the Ch 11 filter UI manages its own
  invalidation. Event payload is intentionally minimal (just
  `subscriptionId` + `change: 'created'|'updated'|'deleted'`) — the web
  UI refetches via the existing CRUD endpoint, so re-sending the DTO over
  the wire would be redundant.
- **Forwarder emits one event per `ForwardJob`, not per source id.** Albums
  stay atomic at the event boundary too: a 3-photo album emits one
  `forward.started` and one `forward.completed` (with
  `destMessageIds: string[]` of length 3) — matches the Ch 5 album-as-
  unit decision. Per-source-id `forward_log` rows still happen as before.
- **SSE route uses `reply.hijack()` + `reply.raw.write`.** `hijack()` tells
  Fastify "I'm taking over this response — don't call .send() or .end()".
  After hijack the handler owns `reply.raw` (the underlying
  `http.ServerResponse`) and the request lifetime. `request.raw.once(
'close')` fires on graceful close, network drop, and test
  `AbortController.abort()` alike — that's where the heartbeat interval
  is cleared and the bus listener unsubscribes. Verified in a dedicated
  test that asserts `bus.listenerCount()` drops from 1 → 0 after abort.
- **`SSE_HEARTBEAT_MS = 25_000`** module constant; `heartbeatMs` deps
  override mirrors the `windowMs` precedent in `albumDebouncer`.
  `buildTestApp({ heartbeatMs: 50 })` lets the heartbeat test run in
  ~150 ms with real timers instead of 25 s. `X-Accel-Buffering: no`
  header disables nginx response buffering for SSE; `Cache-Control:
no-cache, no-transform` covers most other proxies. Initial `: open\n\n`
  comment frame so clients see the stream is live before the first real
  event (which may be many seconds away).
- **Real timers in the heartbeat test, not fake.** `light-my-request`'s
  chunk delivery is `process.nextTick`-driven; fake timers + the chunk
  pipeline race in non-deterministic ways and make heartbeat tests
  flaky. Real timers + a 50 ms interval is more reliable and the
  contract is still what's being tested (a heartbeat does arrive).
- **Test SSE pattern.** `app.inject({ payloadAsStream: true, signal })`
  resolves the promise at `reply.raw.writeHead(...)` time (verified
  against `light-my-request@6.6.0`), so the test can read
  `res.statusCode` / `res.headers` immediately and only then start
  consuming chunks via `res.stream()`. An `AbortController` aborts the
  request to terminate the stream cleanly — the handler's
  `request.raw.once('close')` listener fires on abort. SSE frame
  parsing waits for the `\n\n` terminator AFTER the event line (two
  separate `socket.write` calls can arrive as separate chunks; matching
  on just `event: forward.completed` risks parsing mid-frame).
- **Cookie auth uniformly applies.** The stream route is registered inside
  the existing authed scope, so `requireAuth` runs as a preHandler
  exactly like every other authed route — 401-without-cookie path is
  the standard JSON envelope, no SSE-mode confusion.
- **Per-listener safety net is the bus's try/catch, not
  `socket.writableEnded` guards.** The guards inside the listener and the
  heartbeat are a courtesy (avoid a stray write after Node has half-closed
  the socket), but the actual non-fatal path is the bus catching and
  logging any thrown listener errors. `socket.write` returning `false`
  doesn't matter for personal-use SSE — backpressure is ignored.
- **DI threading.** `CreateForwarderDeps`, `CreatePipelineDeps`,
  `CreateFilterEvaluatorDeps`, `RegisterSubscriptionDeps`,
  `CreateApiServerDeps` all gained `bus: EventBus`. `apps/server/src/index.ts`
  creates the bus once after the DB is open and passes it through the
  whole tree. `apps/server/src/api/testing.ts` `buildTestApp` builds a
  real bus and exposes it on `TestApp.bus` for assertions and for
  driving the SSE test (`testApp.bus.emit({...})`).
- **Tests:** 15 new — 6 in `events/bus.test.ts` (emit/on/unsubscribe,
  occurredAt stamp, listener-isolation, listenerCount, self-unsubscribe
  during dispatch); 5 in `api/routes/stream.test.ts` (401, 200 +
  Content-Type + initial open frame, full event delivery + JSON
  payload, heartbeat with override, cleanup on disconnect); 1 in
  `forwarder.test.ts` (started-before-client emit ordering); 3 in
  `evaluate.test.ts` (filtered emit on rejection, no emit on pass, no
  emit on empty filter set). Existing forwarder/evaluator/subscription
  tests gained event assertions (no new test cases, just expanded).

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
