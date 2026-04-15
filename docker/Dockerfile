# syntax=docker/dockerfile:1

# ── Stage 1: install deps ────────────────────────────────────────────────────
FROM oven/bun:1 AS deps
WORKDIR /app

COPY package.json bun.lock* ./
COPY packages/server/package.json ./packages/server/package.json
COPY packages/client/package.json ./packages/client/package.json

RUN bun install --frozen-lockfile

# ── Stage 2: build client SPA ────────────────────────────────────────────────
FROM deps AS client-build
WORKDIR /app

COPY packages/client ./packages/client
COPY tsconfig.base.json ./

RUN bun run --cwd packages/client build

# ── Stage 3: compile server binary ───────────────────────────────────────────
FROM deps AS server-build
WORKDIR /app

COPY packages/server ./packages/server
COPY tsconfig.base.json ./

RUN bun build --compile \
    --target bun \
    --outfile /app/server-bin \
    packages/server/src/index.ts

# ── Stage 4: minimal production image ────────────────────────────────────────
FROM gcr.io/distroless/cc-debian12 AS production

WORKDIR /app

COPY --from=server-build /app/server-bin ./server
COPY --from=client-build /app/packages/client/dist ./packages/client/dist

EXPOSE 3000

CMD ["./server"]
