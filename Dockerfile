# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=20

# --- Build dist artifacts (TS → JS, Vite → static) ---
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
RUN corepack enable \
 && apt-get update \
 && apt-get install -y --no-install-recommends build-essential python3 ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Copy manifests first so the install layer caches when sources change
# but deps don't.
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/

RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# --- Prune to prod-only deps, keeping native modules compiled above ---
FROM build AS prod-deps
# Switching dev→prod makes pnpm 10 want to purge node_modules, and it prompts
# for confirmation first. BuildKit RUN steps have no TTY and don't inherit CI,
# so pnpm aborts (ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY). Opt out of the
# prompt so the prune runs non-interactively.
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --prod --frozen-lockfile --config.confirm-modules-purge=false

# --- Runtime ---
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Preserve the workspace layout: the server resolves apps/web/dist
# relative to its compiled file at apps/server/dist/api/server.js, so
# apps/server and apps/web must stay siblings. Likewise pnpm symlinks
# inside node_modules/ point into .pnpm/ at the workspace root.
COPY --from=prod-deps /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/server/package.json ./apps/server/
COPY --from=prod-deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build     /app/apps/server/dist ./apps/server/dist
COPY --from=build     /app/apps/server/drizzle ./apps/server/drizzle
COPY --from=build     /app/apps/web/dist ./apps/web/dist
COPY --from=prod-deps /app/packages/shared/package.json ./packages/shared/
COPY --from=prod-deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=build     /app/packages/shared/dist ./packages/shared/dist

# Shared's source package.json points main at src/index.ts (for tsx +
# IDE go-to-definition). Rewrite to compiled dist so node can resolve it
# at runtime.
RUN node -e 'const fs=require("node:fs"); const p=JSON.parse(fs.readFileSync("packages/shared/package.json","utf8")); p.main="./dist/index.js"; p.types="./dist/index.d.ts"; p.exports={".":{types:"./dist/index.d.ts",default:"./dist/index.js"}}; fs.writeFileSync("packages/shared/package.json", JSON.stringify(p,null,2));'

RUN mkdir -p /app/data && chown -R node:node /app

EXPOSE 3000
USER node
WORKDIR /app/apps/server

# Apply migrations on every start (idempotent — drizzle skips applied),
# then exec the server so PID 1 is node and SIGTERM reaches it.
CMD ["sh", "-c", "node dist/db/migrate.js && exec node dist/index.js"]
