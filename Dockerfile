# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=20

# --- build ---
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
RUN corepack enable \
 && apt-get update \
 && apt-get install -y --no-install-recommends build-essential python3 ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Manifests first so the install layer caches independently of source changes.
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/

RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# Bundle server + migrate into self-contained ESM; only the native addons and
# pino stay external (see scripts/bundle-server.mjs).
RUN node scripts/bundle-server.mjs

# Build a minimal runtime node_modules holding just those externals (versions
# pinned to what was bundled against), strip native debug symbols, and drop the
# C/C++ sources kept only for compilation.
RUN mkdir -p /native && cd /native \
 && node -e 'const v=p=>require(`/app/apps/server/node_modules/${p}/package.json`).version;require("fs").writeFileSync("package.json",JSON.stringify({name:"native",private:true,dependencies:{"better-sqlite3":v("better-sqlite3"),re2:v("re2"),pino:v("pino")}}))' \
 && npm install --omit=dev --no-audit --no-fund --loglevel=error \
 && find node_modules -name '*.node' -exec strip --strip-unneeded {} + \
 && rm -rf node_modules/re2/vendor node_modules/better-sqlite3/deps node_modules/better-sqlite3/src \
 && find node_modules -path '*/build/*' ! -name '*.node' -type f -delete \
 && for p in node-gyp prebuild-install tar undici node-abi simple-get tunnel-agent nan minizlib mkdirp-classic; do rm -rf "node_modules/$p" "node_modules/.bin/$p"; done \
 && find node_modules -type d -empty -delete

# Empty data dir, owned by the distroless nonroot uid so a fresh volume inherits it.
RUN mkdir -p /data-stage && touch /data-stage/.keep

# --- runtime ---
FROM gcr.io/distroless/nodejs${NODE_VERSION}-debian12 AS runtime
ENV NODE_ENV=production
# Project root: the app resolves a relative DATABASE_PATH (default ./data/…)
# against cwd, so this lands the DB in /app/data (the mounted volume). Bundle
# paths stay absolute so import.meta.url still resolves apps/web/dist + drizzle.
WORKDIR /app

COPY --from=build /app/apps/server/dist/api/index.bundle.js   /app/apps/server/dist/api/index.bundle.js
COPY --from=build /app/apps/server/dist/db/migrate.bundle.js  /app/apps/server/dist/db/migrate.bundle.js
COPY --from=build /app/apps/server/drizzle                    /app/apps/server/drizzle
COPY --from=build /native/node_modules                        /app/apps/server/node_modules
COPY --from=build /app/apps/web/dist                          /app/apps/web/dist
COPY --from=build --chown=1000:1000   /data-stage             /app/data

EXPOSE 3000
# uid 1000 (not distroless's default 65532) to match the previous image, so a
# data volume it created stays writable after upgrading to this one.
USER 1000

# Shell-less runtime: apply migrations, then start the server, in one node
# process (a failed migration rejects → non-zero exit → restart).
CMD ["-e", "import('./apps/server/dist/db/migrate.bundle.js').then(() => import('./apps/server/dist/api/index.bundle.js'))"]
