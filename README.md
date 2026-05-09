# tg-feed

Personal Telegram channel forwarding userbot with a mobile-friendly web UI for managing
subscriptions and filter rules.

- **Server** — gramjs (MTProto) client + Fastify API + SSE, runs on a dedicated forwarding
  Telegram account separate from your main one.
- **Web** — Vite + React + Tailwind + shadcn/ui SPA for managing subscriptions, attaching
  parameterised filter rules, configuring throttle/delay, and watching live activity.
- **DB** — SQLite (better-sqlite3 + drizzle-orm).
- **Monorepo** — pnpm workspaces; shared types in `packages/shared`.

> **Status:** scaffolding only. See [docs/PROGRESS.md](docs/PROGRESS.md) for the chapter
> checklist and [docs/PLAN.md](docs/PLAN.md) for the full implementation plan.

## Requirements

- Node.js ≥ 20 (tested on 24.x)
- pnpm ≥ 9
- Docker (for production run)

## Quickstart — local dev

```bash
pnpm install
cp .env.example .env
# edit .env — at minimum: TG_API_ID, TG_API_HASH, WEB_PASSWORD, SESSION_SECRET

# one-time: mint a session string for the forwarding account
pnpm tg:login                 # available from Chapter 3 onward

pnpm dev                      # boots server + web in parallel
```

## Quickstart — Docker

```bash
cp .env.example .env          # fill values
docker compose up -d --build
```

Available from Chapter 14. The image runs the server and serves the built web UI on a
single port.

## Scripts

| Script                              | What it does                               |
| ----------------------------------- | ------------------------------------------ |
| `pnpm dev`                          | Run all workspaces in dev mode in parallel |
| `pnpm build`                        | Build all workspaces                       |
| `pnpm test`                         | Run Vitest across all workspaces           |
| `pnpm test:watch`                   | Vitest watch mode                          |
| `pnpm lint` / `pnpm lint:fix`       | ESLint                                     |
| `pnpm format` / `pnpm format:check` | Prettier                                   |
| `pnpm typecheck`                    | `tsc --noEmit` in every workspace          |

## Layout

```
apps/server     # Telegram client + Fastify API + SSE
apps/web        # React SPA
packages/shared # DTOs, zod schemas, cross-net types
docs/           # AGENTS.md, PLAN.md, PROGRESS.md
docker/         # Dockerfile (added in Chapter 14)
```

For per-file conventions and the chapter plan, see [docs/AGENTS.md](docs/AGENTS.md) and
[docs/PLAN.md](docs/PLAN.md).
