# syntax=docker/dockerfile:1

# ── Stage 0: snapshot every workspace manifest ───────────────────────────────
# Docker's COPY can't glob while preserving directory structure, so the deps
# layer would otherwise need one hand-maintained COPY line per workspace —
# a list that silently drifts whenever a package is added (e.g. a new plugin).
# This stage snapshots every package.json under the workspace roots so the
# install layer caches on manifest/lockfile content alone, with no per-package
# upkeep. `cp --parents` recreates each manifest's path under /manifests, and
# `COPY --from` is content-addressed, so unchanged manifests keep the cache.
FROM oven/bun:1 AS manifests
WORKDIR /src
COPY . .
RUN mkdir /manifests \
    && find package.json apps packages -name package.json -not -path '*/node_modules/*' \
       -exec cp --parents {} /manifests/ \;

# ── Stage 1: install deps ────────────────────────────────────────────────────
FROM oven/bun:1 AS deps
WORKDIR /app

COPY --from=manifests /manifests/ ./
COPY bun.lock* ./

# `--ignore-scripts` skips the root `prepare` hook (`vp config`), which is a
# local developer-tooling step and requires `git` — not present in oven/bun.
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --ignore-scripts

# ── Stage 2: build client SPA ────────────────────────────────────────────────
FROM deps AS client-build
WORKDIR /app

COPY packages/shared ./packages/shared
COPY apps/client ./apps/client
COPY tsconfig.base.json ./

# Vite+ (`vp build`) eagerly builds an HTTP client on startup and panics with
# "No CA certificates were loaded from the system" — oven/bun (Debian slim)
# ships without ca-certificates, so install them before the build runs.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN bun run --cwd apps/client build

# ── Stage 3: compile server binary ───────────────────────────────────────────
FROM deps AS server-build
WORKDIR /app

COPY packages/shared ./packages/shared
COPY packages/plugin-sdk ./packages/plugin-sdk
COPY packages/plugins ./packages/plugins
COPY apps/server ./apps/server
COPY tsconfig.base.json ./

RUN bun build --compile \
    --target bun \
    --outfile /app/server-bin \
    apps/server/src/index.ts

# ── Stage 4: minimal production image ────────────────────────────────────────
FROM gcr.io/distroless/cc-debian12 AS production

WORKDIR /app

COPY --from=server-build /app/server-bin ./server
COPY --from=client-build /app/apps/client/dist ./apps/client/dist
# migrate.ts resolves its migrations folder relative to `import.meta.dirname`
# at compile time, so the SQL files must be present at that path in the
# container or startup will crash.
COPY --from=server-build /app/apps/server/drizzle ./apps/server/drizzle

EXPOSE 3000

CMD ["./server"]
