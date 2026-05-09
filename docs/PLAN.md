# PLAN.md — full implementation plan

This is the canonical plan committed to the repo. AI agents and humans should read this
plus [PROGRESS.md](PROGRESS.md) at the start of every session.

---

## Context

Personal-use Telegram forwarding application:

- A **userbot-style backend** (MTProto, not Bot API — channels can't be read via Bot API
  without admin rights) that listens to subscribed channels on a _separate forwarding
  account_, applies filtering rules, and forwards to a destination chat with global
  throttling/delay.
- A **web UI (mobile-friendly)** for adding subscriptions, assigning parameterised filter
  rules, configuring throttle settings, and viewing live activity.
- **Two separate Telegram accounts**: the user's main account is just the human operator;
  the forwarding account's session string is supplied as a secret in `.env`. No in-app
  Telegram login flow — a one-shot CLI `tg:login` script mints the session string to
  paste into env.

Implementation is split into 14 chapters, each sized for one focused session. Progress is
tracked in [PROGRESS.md](PROGRESS.md).

### Forwarding nuances (from Habr article 1030702 — Telethon prior art applies to gramjs too)

- **Album debouncing.** Media groups arrive as N independent messages sharing
  `groupedId`; collect them in a ~2 s window and forward as one album with
  `client.forwardMessages`. Without this, albums fragment.
- **Throttling.** Telegram silently classifies high-rate userbots as spam. Hard floor
  delay between forwards (5–15 s by default, configurable) per destination.
- **FloodWait.** On `FLOOD_WAIT_X`, requeue with `seconds * 1000` ms backoff.
- **Encrypted session storage.** AES-encrypt the session string at rest if persisted to
  DB (env-supplied key). For MVP the env value is the source of truth.
- **Event-driven listening.** `client.addEventHandler(handler, new NewMessage({}))` —
  no polling.

---

## Tech stack

| Concern               | Choice                                               | Reason                                        |
| --------------------- | ---------------------------------------------------- | --------------------------------------------- |
| Language              | TypeScript (strict)                                  | Required                                      |
| Runtime               | Node.js ≥ 20 (ESM)                                   | Required                                      |
| Monorepo              | pnpm workspaces                                      | Lightweight; no need for turbo yet            |
| Telegram client       | `telegram` (gramjs)                                  | Most mature MTProto library for Node          |
| HTTP server           | Fastify                                              | Fast, plugin-based, native SSE, small surface |
| DB                    | SQLite via `better-sqlite3`                          | Required; sync API is simpler                 |
| ORM / query           | `drizzle-orm` + `drizzle-kit`                        | Type-safe, SQL-flavoured, simple migrations   |
| Validation            | `zod`                                                | Shared between API and web                    |
| Logging               | `pino` (+ `pino-pretty` in dev)                      | Structured logs                               |
| Auth                  | Signed cookie via `@fastify/cookie` + `WEB_PASSWORD` | Per user choice                               |
| Web build             | Vite + React + TS                                    | No Next.js per requirement                    |
| Web styling           | Tailwind CSS                                         | Mobile-first                                  |
| Web UI components     | shadcn/ui (Radix primitives + Tailwind, copy-paste)  | Accessible primitives without a heavy lib     |
| Web data              | TanStack Query + native `EventSource`                | Per user choice (SSE for live updates)        |
| Web routing           | React Router                                         | Standard                                      |
| Tests                 | Vitest                                               | Single test runner across workspaces          |
| Lint / format         | ESLint flat config + Prettier                        | Standard                                      |
| Pre-commit            | `simple-git-hooks` + `lint-staged`                   | Lighter than husky                            |
| Process manager (dev) | `tsx watch`                                          | No build step in dev                          |
| Container             | Multi-stage Dockerfile + docker-compose              | One image runs everything                     |

---

## Repo layout

```
tg-feed/
├── apps/
│   ├── server/                # Telegram client + Fastify API + SSE
│   │   ├── src/
│   │   │   ├── index.ts            # entry (boots tg client + http server)
│   │   │   ├── config.ts           # zod-validated env loader
│   │   │   ├── db/                 # drizzle schema, migrations, client
│   │   │   ├── tg/                 # gramjs client, session, login script
│   │   │   ├── forwarding/         # queue, throttle, album debouncer, FloodWait handling
│   │   │   ├── filters/            # rule registry + individual rules
│   │   │   ├── api/                # Fastify plugins + routes
│   │   │   ├── events/             # internal event bus → SSE
│   │   │   └── lib/                # logger, errors, util
│   │   ├── scripts/
│   │   │   └── tg-login.ts         # interactive one-shot to print session string
│   │   ├── tests/
│   │   ├── drizzle.config.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── web/                   # React SPA
│       ├── src/
│       │   ├── main.tsx
│       │   ├── App.tsx
│       │   ├── api/                # fetch client + queries
│       │   ├── pages/              # Login, Dashboard, Subscriptions, Filters, Settings, Activity
│       │   ├── components/         # shadcn/ui primitives + shared
│       │   └── lib/
│       ├── index.html
│       ├── tailwind.config.ts
│       ├── vite.config.ts
│       ├── components.json         # shadcn/ui config
│       ├── package.json
│       └── tsconfig.json
├── packages/
│   └── shared/                # DTOs, zod schemas, filter rule type defs
├── docker/
│   └── Dockerfile             # multi-stage: shared → server → web; final stage = node + static
├── docs/
│   ├── AGENTS.md              # AI-agent dev guide (structure, conventions, commands)
│   ├── PLAN.md                # this file
│   └── PROGRESS.md            # chapter checklist
├── .env.example
├── .gitignore
├── docker-compose.yml         # mounts ./data (sqlite) and ./.env
├── eslint.config.js
├── package.json               # workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── vitest.config.ts
└── README.md
```

### Key conventions

- **`packages/shared`** owns every type that crosses the network boundary: DTOs, zod
  schemas for filter rule params, response/request envelopes. Single source of truth.
- **Filter rules** live as one file per rule under `apps/server/src/filters/rules/`,
  each exporting `{ type, label, paramsSchema, evaluate(msg, params) }`. Rules
  self-register into a central registry on import. The web UI pulls the rule catalogue
  via an API endpoint, so adding a rule = drop a file + restart.
- **Forwarding pipeline** is a per-destination FIFO queue; one worker drains each queue
  with a configurable delay between sends, rescheduling on FloodWait.
- **Internal event bus** emits `forward.started`, `forward.completed`, `forward.failed`,
  `forward.flood_wait`, `subscription.changed`. The SSE endpoint subscribes and pushes
  to web clients.
- **Config** is a single `apps/server/src/config.ts` with a zod schema; the rest of the
  app imports the parsed object. No `process.env` access elsewhere.

---

## Chapters

Each chapter ends with green tests, lint pass, working scripts, and an updated
[PROGRESS.md](PROGRESS.md).

### Chapter 1 — Repo bootstrap _(scaffolding only, no business logic)_

- pnpm workspace, root `package.json`, `tsconfig.base.json`, ESLint flat config,
  Prettier, `.editorconfig`, `.gitignore`, `simple-git-hooks` + `lint-staged`.
- Empty workspaces: `apps/server`, `apps/web`, `packages/shared` — each with
  `package.json`, `tsconfig.json` extending base, and a placeholder `src/index.ts`.
- Vitest at root, picking up tests across workspaces.
- `docs/AGENTS.md`, `docs/PLAN.md` (this file), `docs/PROGRESS.md`, `README.md`,
  `.env.example`.
- Smoke-test: `pnpm install && pnpm lint && pnpm typecheck && pnpm test` all green.

### Chapter 2 — DB layer

- `better-sqlite3` + `drizzle-orm` + `drizzle-kit` in `apps/server`.
- Schema in `apps/server/src/db/schema.ts`:
  - `subscriptions(id, sourceChatId, sourceTitle, destinationChatId, enabled, createdAt)`
  - `subscription_filters(id, subscriptionId, ruleType, params JSON, enabled)`
  - `app_settings(key PK, value JSON)` — global throttle/delay settings
  - `forward_log(id, subscriptionId, sourceMessageId, destMessageId, status, error, createdAt)`
  - `tg_session(key PK, encryptedString)` — optional cache (env wins for MVP)
- drizzle migration setup; `pnpm db:generate`, `pnpm db:migrate`.
- Singleton DB client with WAL pragma.
- `apps/server/src/config.ts` (zod-validated env).
- Tests: in-memory SQLite fixture; CRUD smoke per table.

### Chapter 3 — Telegram client core

- `telegram` (gramjs) + `input` deps.
- `apps/server/src/tg/client.ts`: factory from env (`TG_API_ID`, `TG_API_HASH`,
  `TG_SESSION_STRING`), auto-reconnect.
- `apps/server/scripts/tg-login.ts`: interactive — phone → code → 2FA → print session
  string. Document in README.
- `apps/server/src/tg/listener.ts`: `NewMessage` handler logs basic info.
- Resolve subscriptions on startup (join channels by username/invite if needed).
- Wire into `apps/server/src/index.ts` so `pnpm --filter server dev` connects.
- Tests: `MessageMatcher` unit tests for "does this event match an active subscription".

### Chapter 4 — Forwarding pipeline (no filters yet)

- `apps/server/src/forwarding/queue.ts`: per-destination in-memory FIFO; one worker per
  destination.
- `apps/server/src/forwarding/throttle.ts`: read `delayMs` from `app_settings`; worker
  sleeps `delayMs` between sends.
- `apps/server/src/forwarding/forwarder.ts`: `client.forwardMessages` + write
  `forward_log`.
- `apps/server/src/forwarding/floodwait.ts`: wrap sends; on `FloodWaitError` requeue
  with `seconds * 1000` delay.
- Wire listener → forward. Blanket forwarding for enabled subscriptions.
- Tests: queue ordering; throttle timing (vitest fake timers); FloodWait retry path.

### Chapter 5 — Album / grouped media handling

- `apps/server/src/forwarding/albumDebouncer.ts`: keyed by `groupedId`, collect with a
  2 s timer, emit a single `ForwardJob` carrying the message array. Pass-through for
  ungrouped messages.
- Use `forwardMessages` (plural; gramjs accepts an array of ids and preserves album).
- Tests: deterministic with fake timers.

### Chapter 6 — Filter framework + first rules

- `packages/shared/src/filters.ts`: rule type defs and zod schemas for each rule's
  params.
- `apps/server/src/filters/registry.ts`: `register(rule)`, `getRule(type)`,
  `listRules()`.
- `apps/server/src/filters/rules/*.ts`:
  - `text-contains` (string param + caseInsensitive bool)
  - `text-excludes` (string param)
  - `text-regex` (string param)
  - `has-media` (boolean)
  - `min-length` (number)
  - `sender-allowlist` (string array — JSON object example)
- `apps/server/src/filters/evaluate.ts`: load rules for a subscription, AND-combine,
  return `{ pass, reasons }`. Skipped messages logged with reason.
- Tests: each rule against synthetic fixtures; evaluator combinator.

### Chapter 7 — API server (Fastify + auth)

- Fastify + `@fastify/cookie`, `@fastify/cors`, `@fastify/static`, error handler that
  maps zod issues → 400.
- Auth: `WEB_PASSWORD`; `POST /api/auth/login` sets a signed session cookie; auth
  preHandler.
- Routes (all under `/api`, all using shared zod schemas):
  - `GET /me`
  - `GET/POST/PATCH/DELETE /subscriptions`
  - `GET /filters/catalog`
  - `GET/POST/PATCH/DELETE /subscriptions/:id/filters`
  - `GET/PUT /settings`
  - `GET /forward-log` (paginated)
- Tests: Fastify `inject()` — auth, validation errors, CRUD round-trips.

### Chapter 8 — Internal event bus + SSE

- `apps/server/src/events/bus.ts`: typed `EventEmitter` wrapper.
- Forwarder + filter evaluator emit events.
- `GET /api/stream` SSE endpoint: re-emits bus events to authenticated clients;
  heartbeat every 25 s.
- Tests: SSE smoke test via `inject({ payloadAsStream: true })`.

### Chapter 9 — Web app skeleton

- Vite + React + TS + Tailwind. `pnpm dlx shadcn@latest init` plus a couple of base
  components (`button`, `input`, `dialog`, `sheet`).
- Dev proxy: `/api` and `/api/stream` → server.
- `/login` page; on success cookie is set, redirect to dashboard.
- Mobile-first layout shell with bottom nav: Subscriptions / Filters / Settings /
  Activity.
- TanStack Query setup; `apiClient.ts` with `credentials: 'include'`.
- Tests: a couple of `@testing-library/react` + jsdom smokes.

### Chapter 10 — Web: Subscriptions UI

- List, add (paste t.me link or @username — backend resolves), toggle enabled, delete.
- Touch-friendly rows; pull-to-refresh via TanStack Query refetch button.

### Chapter 11 — Web: Filters UI

- Per subscription, show attached filters with their params.
- "Add filter" picks from the catalog; render a form generated from the rule's zod
  schema.
- Save → POST.

### Chapter 12 — Web: Settings UI

- Form for global delay (ms), per-destination concurrency (always 1 for v1), other
  flags.

### Chapter 13 — Web: Activity feed

- Subscribe to `EventSource('/api/stream')`.
- Rolling list with status (sent / filtered / flood-waited / failed) and source →
  destination links.

### Chapter 14 — Containerise + deployment

- `docker/Dockerfile`: multi-stage (`deps` → `build` → `runtime` on node-slim, non-root,
  one port; web `dist/` served by Fastify static).
- `docker-compose.yml`: one service `tg-feed`, mounts `./data:/app/data` and `./.env`,
  restart policy.
- README updates (local + prod recipe).
- Health endpoint `/api/health`.
- Final pass: smoke-test `docker compose up`, run a real channel forward end-to-end.

---

## Verification

**Per chapter, before marking done:**

1. `pnpm lint` clean
2. `pnpm typecheck` clean across all workspaces
3. `pnpm test` green
4. The chapter's user-visible script works (`pnpm dev`, `pnpm db:migrate`,
   `pnpm tg:login`, etc.)

**End-to-end (after Chapter 14):**

- `cp .env.example .env`; fill `TG_API_ID`, `TG_API_HASH`, `TG_SESSION_STRING`,
  `WEB_PASSWORD`, `SESSION_SECRET`, `DESTINATION_CHAT_ID`.
- `pnpm tg:login` (one-time).
- `pnpm dev` boots server + web; open `http://localhost:5173`, log in, add a
  subscription → public channel, attach a `text-contains` filter, observe forwards in
  the destination chat and live entries in the Activity feed.
- `docker compose up -d --build` repeats the above against the bundled image.
