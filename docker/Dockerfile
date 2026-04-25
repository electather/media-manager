# syntax=docker/dockerfile:1

# ── Stage 1: install deps ────────────────────────────────────────────────────
FROM oven/bun:1 AS deps
WORKDIR /app

COPY package.json bun.lock* ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/client/package.json ./apps/client/package.json
COPY packages/shared/package.json ./packages/shared/package.json

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
