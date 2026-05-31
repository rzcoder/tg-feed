# Contributing to tg-feed

## Prerequisites

- Node.js ≥ 20 (tested on 24.x)
- pnpm ≥ 9
- A **dedicated** Telegram account for forwarding — not your main one. gramjs shares
  the session across the whole account, and Telegram readily classifies a userbot as
  spam, so keep it isolated.

## Getting started

```bash
pnpm install
cp .env.example .env
pnpm db:migrate                # apply DB migrations (idempotent)
```

Fill in `.env` (at minimum `TG_API_ID`, `TG_API_HASH`, `WEB_PASSWORD`, `SESSION_SECRET`),
then mint a session string for the forwarding account:

```bash
pnpm tg:login                  # interactive: phone → code → 2FA → prints session string
                               # paste it into .env as TG_SESSION_STRING
pnpm dev                       # boots server + web in parallel
```

### Why two sets of Telegram credentials?

MTProto separates the _application_ from the _account_:

- **`TG_API_ID` + `TG_API_HASH`** identify the _application_ (like an OAuth
  `client_id`/`client_secret`), minted once at <https://my.telegram.org>. They survive
  any change of forwarding account.
- **`TG_SESSION_STRING`** is the result of logging in (phone → code → 2FA): "this
  application, signed in as this account." It's the variable part.

gramjs is a library, not an official client, so it has no api_id of its own — Telegram
requires every developer to register their own application. (The Bot API would fold both
into a single `bot_token`, but bots can't read channels without admin rights, which is
why tg-feed uses a userbot/MTProto instead.)

## Checks

Before opening a PR, make sure these pass — CI runs all of them:

```bash
pnpm lint          # ESLint
pnpm format        # Prettier (or pnpm format:check)
pnpm typecheck     # tsc --noEmit in every workspace
pnpm test          # Vitest across all workspaces
pnpm build         # server (tsc) + web (Vite)
```

A pre-commit hook runs `lint-staged` (ESLint + Prettier on staged files) automatically.

## Conventions

- **TypeScript strict, no `any`.** Use `import type` for type-only imports.
- **`apps/server/src/config.ts` is the only module that reads `process.env`** — everything
  else imports the parsed `config` object.
- **Cross-network types and Zod schemas live in `packages/shared`** and are imported by
  both the server and the web client. Add new DTOs there, not in one app.
- **Logging** uses pino (`apps/server/src/lib/logger.ts`); sensitive fields are redacted.
  Transient/network errors log at `warn`, unrecoverable ones at `error`.

## Pull requests

1. Branch off `master`.
2. Keep changes focused; one logical change per PR.
3. Ensure all checks above pass.
4. Describe what changed and why in the PR body.

## Security

Please do not file public issues for security problems — see [SECURITY.md](SECURITY.md).
