# Deploy — Docker on ARM Ubuntu

The default deploy path is the published multi-arch image
`ghcr.io/rzcoder/tg-feed`. Rebuilt and pushed by
[`.github/workflows/docker.yml`](../.github/workflows/docker.yml) on every
GitHub Release for `linux/amd64` and `linux/arm64`.

On the server you only need Docker and the compose plugin. No Node, no pnpm,
no build toolchain.

## One-time setup

Run as the user that should own the data files.

### 1. Install Docker

Skip if you already have `docker` and `docker compose` working.

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
# log out + back in (or `newgrp docker`) so the group membership takes effect
docker compose version   # should print v2.x
```

### 2. Make a deploy directory

The `compose.yaml` in the repo is what runs on the server — but you don't
need the whole repo there. Copy just the two files you need:

```bash
mkdir -p ~/tg-feed && cd ~/tg-feed

curl -fsSL -o compose.yaml \
  https://raw.githubusercontent.com/rzcoder/tg-feed/master/compose.yaml
curl -fsSL -o .env.example \
  https://raw.githubusercontent.com/rzcoder/tg-feed/master/.env.example

cp .env.example .env
$EDITOR .env
```

Fill in at minimum:

- `TG_API_ID`, `TG_API_HASH` — from <https://my.telegram.org>
- `WEB_PASSWORD`, `SESSION_SECRET` — long random strings
- `TG_SESSION_ENCRYPTION_KEY` — see comment in `.env.example`

Leave `DATABASE_PATH=./data/tg-feed.sqlite` as is — it resolves relative to
the workspace root inside the container, which is mounted to `./data` on the
host.

### 3. Prepare data directory

```bash
mkdir -p data

# If your host user isn't UID 1000, export it so the container writes files
# you can read. Persist in ~/.bashrc if you want this to stick.
echo "UID=$(id -u)" >> .env
echo "GID=$(id -g) " >> .env
```

### 4. Make the GHCR package public (one-time, on the GitHub side)

A new GHCR package is **private by default** — the first release pushes the
image, then you flip it to public once: GitHub → your profile → Packages →
`tg-feed` → Package settings → Change visibility → Public.

If you want to keep it private, log in to GHCR on the server with a PAT that
has `read:packages`:

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GH_USERNAME" --password-stdin
```

### 5. Pull + start

```bash
docker compose pull
docker compose up -d
docker compose logs -f tg-feed
```

The container runs `node dist/db/migrate.js` before starting the server, so
migrations are applied automatically on every boot (drizzle skips
already-applied ones — safe to re-run).

### 6. Mint a Telegram session

The forwarding account's session can be created either way:

**Option A — from the web UI.** Open `http://<server>:3000`, log in with
`WEB_PASSWORD`, go to Settings → Telegram, and sign in. Requires
`TG_SESSION_ENCRYPTION_KEY` to be set.

**Option B — interactive CLI in the container.** Useful if the web path
is blocked or you prefer a session string in `.env`:

```bash
docker compose run --rm tg-feed sh -c "node dist/scripts/tg-login.js"
# paste phone → code → 2FA. Copy the printed session string into .env as
# TG_SESSION_STRING, then `docker compose up -d` to restart.
```

(If `dist/scripts/tg-login.js` doesn't exist — the script is currently
TS-only via `tsx`. Use Option A or temporarily run a one-off node:20 image
with the repo cloned to mint the session.)

## Reverse proxy

Put nginx/Caddy/Cloudflare Tunnel in front for TLS. The container speaks
plain HTTP on `PORT` (default 3000), bound to `0.0.0.0` — bind only to
loopback by setting `ports: ["127.0.0.1:3000:3000"]` in `compose.yaml`
override when fronting with a proxy on the same host.

Minimal Caddy config:

```caddy
tg-feed.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

## Updates

```bash
cd ~/tg-feed
docker compose pull && docker compose up -d
docker compose logs -f tg-feed   # watch the boot, ctrl-c when steady
```

`pull` fetches the new image; `up -d` recreates the container with it.
Migrations run during boot. Old image is kept until you prune
(`docker image prune`), so you can roll back instantly.

### Pinning a version

By default `compose.yaml` tracks `latest`, which moves on every non-prerelease
GitHub Release. To pin:

```bash
echo "TG_FEED_VERSION=0.2.0" >> .env
docker compose up -d
```

Image tags published per release: `{version}` (e.g. `0.2.0`), `{major.minor}`
(e.g. `0.2`), and `latest` (only for non-prerelease).

### Rollback

```bash
# In .env:
TG_FEED_VERSION=0.1.9
# then:
docker compose up -d
```

⚠️ Drizzle has no down-migrations. If the version you're rolling back to
had a different schema, restore `data/tg-feed.sqlite` from a backup taken
before the upgrade — otherwise the older code may crash on columns it
doesn't know about (or that no longer exist).

## Backups

The entire app state is two paths:

- `data/tg-feed.sqlite` (+ `-wal`, `-shm` while WAL mode is active)
- `.env`

A nightly cron is enough for a personal deploy:

```cron
# crontab -e — 04:17 daily, keep 14 days
17 4 * * *  cd /home/ubuntu/tg-feed && docker compose exec -T tg-feed sqlite3 /app/data/tg-feed.sqlite ".backup '/app/data/backup-$(date +\%F).sqlite'" && find data -name 'backup-*.sqlite' -mtime +14 -delete
```

For zero-downtime continuous replication, see Litestream.

## Troubleshooting

**`docker compose pull` says "denied" or "not found"**
The GHCR package is private or the image hasn't been pushed yet. Trigger the
`docker` workflow manually from the Actions tab (workflow_dispatch), or
publish a release.

**Container restarts in a loop, logs show better-sqlite3 / re2 errors**
Architecture mismatch. Confirm with `docker image inspect
ghcr.io/rzcoder/tg-feed:latest | grep Architecture` — should match `uname
-m` on the host (`arm64` ↔ `aarch64`, `amd64` ↔ `x86_64`). If you're on
ARM and pulled the image when only amd64 was published, re-pull after the
multi-arch workflow finishes.

**Container starts but data/tg-feed.sqlite is root-owned and unreadable**
The `user:` line in `compose.yaml` didn't pick up your host UID. Run
`UID=$(id -u) GID=$(id -g) docker compose up -d` once, then `chown -R
$USER:$USER data/` to fix existing files.

**`/api/*` returns 401 from the proxy**
Auth cookies require the proxy to forward `Host` and (for `Secure` cookies)
terminate TLS. Most reverse proxies do this by default; if you set
`X-Forwarded-*` headers, the server respects them.

## What this deploy is _not_

- TLS termination — bring your own (Caddy, nginx, Cloudflare Tunnel).
- Off-host backups — `data/` is on the local volume only.
- Multi-tenant — single user, single forwarding account per container.

## Alternative: build the image locally

If you don't want to pull from GHCR (private fork, air-gapped server, etc.):

```bash
git clone https://github.com/rzcoder/tg-feed.git ~/tg-feed-src
cd ~/tg-feed-src
docker build -t tg-feed:local .
# then in your deploy compose.yaml:
#   image: tg-feed:local
```

Build takes ~3–5 minutes on a Pi 4-class ARM board, mostly compiling
native modules.
