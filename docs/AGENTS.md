# AGENTS.md — developer & AI-agent guide

This file is the canonical orientation document for anyone (human or AI) working in this
repo. Read it first. Pair it with [PLAN.md](PLAN.md) (full plan) and
[PROGRESS.md](PROGRESS.md) (chapter checklist).

---

## What this project is

Personal-use Telegram forwarder. A dedicated Telegram **userbot** (MTProto, not Bot API)
listens to channels the user has subscribed to, applies filtering rules, and forwards
matching messages to a destination chat with global throttling. A small web UI manages
subscriptions, filters, and settings.

Two Telegram accounts are involved:

- **Main account** — the human operator. Not used by code.
- **Forwarding account** — separate account whose `StringSession` is supplied via env
  (`TG_SESSION_STRING`). Generated once via `pnpm tg:login`.

---

## Tech stack

| Concern         | Choice                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------ |
| Language        | TypeScript (strict, NodeNext modules, ES2022 target)                                       |
| Runtime         | Node.js ≥ 20, ESM (`"type": "module"`)                                                     |
| Monorepo        | pnpm workspaces                                                                            |
| Telegram client | `telegram` (gramjs)                                                                        |
| HTTP            | Fastify + `@fastify/cookie` + `@fastify/static` + SSE                                      |
| DB              | SQLite via `better-sqlite3`, queries via `drizzle-orm` (+ `drizzle-kit` migrations)        |
| Validation      | `zod` (schemas live in `packages/shared` and are reused by the API and the UI)             |
| Logging         | `pino` (+ `pino-pretty` in dev)                                                            |
| Web             | Vite + React + Tailwind + shadcn/ui + React Router + TanStack Query + native `EventSource` |
| Tests           | Vitest (single root config, picks up tests across workspaces)                              |
| Lint / format   | ESLint flat config + Prettier                                                              |
| Pre-commit      | `simple-git-hooks` + `lint-staged`                                                         |
| Container       | Multi-stage Dockerfile + docker-compose (single image)                                     |

---

## Layout

```
apps/server                   # Telegram client + Fastify API + SSE
  src/
    index.ts                  # entry: boots tg client + http server
    config.ts                 # zod-validated env loader  (Chapter 2)
    db/                       # drizzle schema, migrations, client  (Chapter 2)
    tg/                       # gramjs client, session, listener  (Chapter 3)
    forwarding/               # queue, throttle, album debouncer, FloodWait  (Chapters 4–5)
    filters/                  # rule registry + individual rules  (Chapter 6)
    api/                      # Fastify plugins + routes  (Chapter 7)
    events/                   # internal event bus → SSE  (Chapter 8)
    lib/                      # logger, errors, util
  scripts/
    tg-login.ts               # one-shot to mint a session string  (Chapter 3)

apps/web                      # React SPA  (filled in from Chapter 9)
  src/
    main.tsx, App.tsx
    api/                      # fetch client + TanStack Query hooks
    pages/                    # Login, Dashboard, Subscriptions, Filters, Settings, Activity
    components/               # primitives (shadcn/ui) + shared
    lib/

packages/shared               # DTOs, zod schemas, filter rule type defs
docker/                       # Dockerfile  (Chapter 14)
docs/                         # this file + PLAN.md + PROGRESS.md
```

---

## Commands

| Command                             | Purpose                                                   |
| ----------------------------------- | --------------------------------------------------------- |
| `pnpm install`                      | install everything (run once, and after lockfile changes) |
| `pnpm dev`                          | run all workspaces in dev (parallel)                      |
| `pnpm test`                         | run Vitest across the repo                                |
| `pnpm test:watch`                   | Vitest watch                                              |
| `pnpm lint` / `pnpm lint:fix`       | ESLint                                                    |
| `pnpm format` / `pnpm format:check` | Prettier                                                  |
| `pnpm typecheck`                    | `tsc --noEmit` in every workspace                         |
| `pnpm build`                        | `tsc -b` everywhere                                       |
| `pnpm db:generate`                  | drizzle-kit generate (Chapter 2+)                         |
| `pnpm db:migrate`                   | apply migrations (Chapter 2+)                             |
| `pnpm tg:login`                     | interactive flow to print a session string (Chapter 3+)   |
| `docker compose up -d --build`      | run the bundled image (Chapter 14+)                       |

---

## Conventions (read before editing)

1. **No `process.env` outside `apps/server/src/config.ts`.** That file owns env parsing
   (zod-validated). Everything else imports the parsed `config` object.
2. **All cross-network types live in `@tg-feed/shared`.** Server validates requests with
   the shared zod schemas; web infers types from the same module. Single source of truth.
3. **All DB access goes through drizzle**, never raw `better-sqlite3` `.prepare()` outside
   `src/db/`.
4. **Adding a filter rule:**
   - add the params zod schema + inferred type to `packages/shared/src/filters.ts`
     (and append the rule type to `FILTER_RULE_TYPES`)
   - drop a file at `apps/server/src/filters/rules/<name>.ts` exporting a
     `FilterRule<'<name>'>` (`{ type, label, paramsSchema, evaluate(context, params) }`)
   - register it in `createDefaultRegistry()` at
     `apps/server/src/filters/rules/index.ts` — one `register(...)` line
   - the web UI picks it up automatically via `GET /api/filters/catalog` (Ch 7+)
5. **No business logic in `index.ts` files.** They wire modules together; logic lives in
   focused modules.
6. **Keep code DRY but not over-abstracted.** If you've copy-pasted twice, extract on the
   third occurrence — not before.
7. **Tests live next to code** as `*.test.ts` (or under a workspace's `tests/` dir for
   integration tests).
8. **Logging:** structured `pino` only — no `console.log` in shipped code (Chapter 1
   placeholders are an exception, swapped out in Chapter 3).
9. **Errors:** throw typed errors from `src/lib/errors.ts`. The Fastify error handler
   maps them + zod issues to JSON responses.
10. **Secrets:** anything that could authenticate as the forwarding account
    (`TG_SESSION_STRING`, encryption keys, `SESSION_SECRET`, `WEB_PASSWORD`) MUST come
    from env. Never log them.

---

## Workflow for AI agents

1. Open [PROGRESS.md](PROGRESS.md). Find the current chapter (marked `→`).
2. Read the corresponding section in [PLAN.md](PLAN.md).
3. Before editing, run `pnpm install`, `pnpm typecheck`, `pnpm test` to ensure the repo
   is green.
4. Implement only that chapter — do **not** jump ahead. The plan splits chapters
   deliberately to keep sessions tractable.
5. Add tests next to the code you write. Each chapter's "Tests:" bullet lists the
   minimum.
6. Run `pnpm lint && pnpm typecheck && pnpm test` before declaring the chapter done.
7. Update [PROGRESS.md](PROGRESS.md): tick the chapter, add a short note about anything
   surprising / deferred / decided, move the `→` marker to the next chapter.
8. Commit. Conventional commit style: `chapter(N): <summary>`.

---

## When something is ambiguous

If `PLAN.md` doesn't specify, prefer the simplest thing that works for personal use:
single-user, single-process, single-host. We are explicitly **not** building a
multi-tenant SaaS. Add complexity only when a chapter calls for it.
