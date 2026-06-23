# syntax=docker/dockerfile:1

# ── Stage 1: install deps ────────────────────────────────────────────────────
FROM oven/bun:1 AS deps
WORKDIR /app

COPY package.json bun.lock* ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/client/package.json ./apps/client/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/plugin-sdk/package.json ./packages/plugin-sdk/package.json
COPY packages/plugins/discord/package.json ./packages/plugins/discord/package.json
COPY packages/plugins/fanart/package.json ./packages/plugins/fanart/package.json
COPY packages/plugins/inbox/package.json ./packages/plugins/inbox/package.json
COPY packages/plugins/jellyfin/package.json ./packages/plugins/jellyfin/package.json
COPY packages/plugins/ntfy/package.json ./packages/plugins/ntfy/package.json
COPY packages/plugins/plex/package.json ./packages/plugins/plex/package.json
COPY packages/plugins/seerr/package.json ./packages/plugins/seerr/package.json
COPY packages/plugins/telegram/package.json ./packages/plugins/telegram/package.json
COPY packages/plugins/tmdb/package.json ./packages/plugins/tmdb/package.json
COPY packages/plugins/trakt/package.json ./packages/plugins/trakt/package.json
COPY packages/plugins/tvdb/package.json ./packages/plugins/tvdb/package.json

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
