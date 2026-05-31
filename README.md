# tg-feed

Personal Telegram channel forwarding userbot with a mobile-friendly web UI for managing
subscriptions and filter rules.

- **Server** — gramjs (MTProto) client + Fastify API + SSE, runs on a dedicated forwarding
  Telegram account separate from your main one.
- **Web** — Vite + React + Tailwind + shadcn/ui SPA for managing subscriptions, attaching
  parameterised filter rules, configuring throttle/delay, and watching live activity.
- **DB** — SQLite (better-sqlite3 + drizzle-orm).
- **Monorepo** — pnpm workspaces; shared types in `packages/shared`.

> **Status:** actively developed; usable for personal forwarding. See
> [CONTRIBUTING.md](CONTRIBUTING.md) to get a dev environment running.

## Requirements

- Node.js ≥ 20 (tested on 24.x)
- pnpm ≥ 9
- Docker (for production run)

## Quickstart — local dev

```bash
pnpm install
cp .env.example .env
# edit .env — at minimum: TG_API_ID, TG_API_HASH, WEB_PASSWORD, SESSION_SECRET

pnpm db:migrate               # apply DB migrations (idempotent)

# one-time: mint a session string for the forwarding account
pnpm tg:login                 # interactive: phone → code → 2FA → prints session string
                              # paste the printed string into .env as TG_SESSION_STRING

pnpm dev                      # boots server + web in parallel
```

> `pnpm tg:login` reads `TG_API_ID` / `TG_API_HASH` from `.env` if present and prompts
> for them otherwise. Run it on the **forwarding account** — not your main one.

## Quickstart — Docker

```bash
cp .env.example .env          # fill values
docker compose up -d --build
```

The image runs the server and serves the built web UI on a single port.

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

## Telegram Web App bot (optional)

You can open the web client directly inside a Telegram bot (as a [Mini
App](https://core.telegram.org/bots/webapps)) and sign in by your Telegram account
instead of typing the password. The password login stays available as a fallback.

Setup:

1. Create a bot with [@BotFather](https://t.me/BotFather) (`/newbot`) and copy its token.
2. Find your numeric Telegram user id (e.g. via [@userinfobot](https://t.me/userinfobot)).
3. Set in `.env`:

   ```bash
   TG_BOT_TOKEN=123456:your-bot-token
   TG_BOT_ADMIN_IDS=12345678          # comma-separated for multiple admins
   PUBLIC_URL=https://tg-feed.example.com   # public HTTPS URL of the web client
   ```

4. Restart the server. On boot the bot sets its menu button + `/start` button to open
   `PUBLIC_URL`. Tap it in Telegram and you're signed in automatically.

How it works: inside Telegram the client posts the signed `initData` to
`POST /api/auth/telegram`; the server verifies its HMAC against the bot token and checks
the user against `TG_BOT_ADMIN_IDS` before minting the same session a password login
would. Telegram requires **HTTPS** for Mini Apps — front the server with a TLS-terminating
reverse proxy (see `compose.yaml` notes). Leave `TG_BOT_TOKEN` / `TG_BOT_ADMIN_IDS` blank
to disable the bot entirely (password-only).

## Layout

```
apps/server     # Telegram client + Fastify API + SSE
apps/web        # React SPA
packages/shared # DTOs, zod schemas, cross-net types
Dockerfile      # production image (server + built web UI)
compose.yaml    # Docker Compose for production
```

To set up a dev environment and contribute, see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
