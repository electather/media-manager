# Deployment Design

**Date:** 2026-04-24
**Status:** Draft

## Overview

This document describes the deployment strategy for the nama monorepo. Two independent deployment targets share the same application code but differ in runtime and infrastructure:

- **Cloudflare** — hosted deployment using Cloudflare Workers + Assets
- **Docker Compose** — self-hosted deployment using a single compiled container

---

## Architecture

### Cloudflare (Hosted)

The Hono server runs as a Cloudflare Worker. The React SPA (static export) is served via Wrangler's `[assets]` binding — Cloudflare serves static files from its CDN edge and only forwards unmatched requests to the Worker. There is no SSR; the client is a pure static export.

The database is Turso (hosted libSQL), accessed over HTTP using the existing `@libsql/client`. Wrangler handles bundling of the Worker TypeScript at deploy time using its built-in esbuild pipeline; no separate server build step is required before `wrangler deploy`.

A new file `packages/server/src/worker.ts` serves as the Workers entry point and acts as a thin composition layer that imports only the parts of the server that are Workers-compatible (API routes, auth, MCP handler, error handling). It exports the Hono app as a default export. Business logic that is incompatible with the Workers runtime is excluded (see [Workers Compatibility](#workers-compatibility)).

**Environments:**

| Environment | Trigger            | URL                                   |
| ----------- | ------------------ | ------------------------------------- |
| Production  | Release tag (`v*`) | `app.example.com`                     |
| Nightly     | Push to `main`     | `nightly.app.example.com`             |
| PR Preview  | PR open/update     | `app-pr-{number}.account.workers.dev` |

PR preview Workers are deleted when the PR is closed (see [PR Preview Cleanup](#pr-preview-cleanup)).

### Docker Compose (Self-Hosted)

A single container runs the compiled Hono server binary, which also serves the client's static files from disk. SQLite is stored in a named Docker volume mounted at `/data`. No other services are required.

Images are published to `ghcr.io` with two rolling tags:

| Git event            | Tags pushed                                        |
| -------------------- | -------------------------------------------------- |
| Push to `main`       | `ghcr.io/org/app:nightly`                          |
| Release tag `v1.2.3` | `ghcr.io/org/app:latest`, `ghcr.io/org/app:v1.2.3` |

PR branches do not produce Docker images.

---

## Workers Compatibility

The current `packages/server/src/index.ts` entry point uses several APIs that are not available in the Cloudflare Workers runtime. The new `worker.ts` entry point excludes or replaces each one:

| Item                                     | `index.ts` usage                   | `worker.ts` behaviour                                                                                                                                                         |
| ---------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `serveStatic` from `hono/bun`            | Serves `packages/client/dist`      | Omitted — Cloudflare Assets handles all static file serving including SPA fallback                                                                                            |
| `scheduler` (croner)                     | Starts a persistent cron scheduler | Omitted — the scheduler requires a long-lived process. Scheduled jobs are not supported in the Cloudflare deployment. Cloudflare Cron Triggers are a future option if needed. |
| `mkdirSync` in `db/client.ts`            | Creates the local SQLite directory | `db/client.ts` is updated to skip `mkdirSync` when the connection URL is not a `file:` path (i.e. when connecting to Turso).                                                  |
| `node:async_hooks` (`AsyncLocalStorage`) | Request context propagation        | Compatible with Workers when `nodejs_compat` is declared in `wrangler.toml`.                                                                                                  |
| `node:path`, `node:fs` (via migrate.ts)  | Migration runner at startup        | Omitted from `worker.ts` — migrations run as a pre-deploy CI step instead.                                                                                                    |

The Hono app, API router, auth handler, MCP handler, error middleware, and plugin runtime are all Workers-compatible and are imported by `worker.ts` unchanged.

---

## Environment Variables

### Required Variables (all environments)

| Variable             | Purpose                          | Notes                                           |
| -------------------- | -------------------------------- | ----------------------------------------------- |
| `BETTER_AUTH_SECRET` | Auth signing secret              | Required, min 1 char                            |
| `BETTER_AUTH_URL`    | Auth base URL                    | Required; http acceptable for local/self-hosted |
| `ENCRYPTION_KEY`     | Plugin credential encryption key | Required, min 1 char                            |
| `APP_EXTERNAL_URL`   | Public-facing URL                | Required, http/https only                       |
| `SQLITE_PATH`        | Database connection URL          | See notes below                                 |

**`SQLITE_PATH` in each environment:**

- **Docker (self-hosted):** `file:/data/nama.db` — local SQLite file in the volume
- **Cloudflare (all envs):** Turso URL, e.g. `libsql://my-db.turso.io`

### Cloudflare-Only Variables

| Variable                      | Purpose                                                       |
| ----------------------------- | ------------------------------------------------------------- |
| `LIBSQL_AUTH_TOKEN`           | Turso auth token (required when `SQLITE_PATH` is a Turso URL) |
| `BETTER_AUTH_TRUSTED_ORIGINS` | Comma-separated allowed origins (optional)                    |

The `LIBSQL_AUTH_TOKEN` variable is added to the server's env schema. `db/client.ts` is updated to pass it to `createClient({ url, authToken })` when present.

### Optional Variables

| Variable                    | Default   | Purpose                                                                                                |
| --------------------------- | --------- | ------------------------------------------------------------------------------------------------------ |
| `PORT`                      | `3000`    | HTTP listen port                                                                                       |
| `HOST`                      | `0.0.0.0` | HTTP listen host                                                                                       |
| `CACHE_PROVIDER`            | `memory`  | `memory` or `redis`                                                                                    |
| `REDIS_URL`                 | —         | Required when `CACHE_PROVIDER=redis`                                                                   |
| `EMAIL_PROVIDER_CONFIGURED` | `false`   | Set to `true` when a transactional-email provider is wired; gates email-dependent UI via public config |

---

## Dockerfile Optimisations

The existing `docker/Dockerfile` is updated with the following improvements:

- **Fix shared package copy** — `packages/shared` source files and `package.json` are copied in every build stage that depends on `@nama/shared`. The current Dockerfile omits this, which breaks workspace dependency resolution.
- **BuildKit cache mounts** — `--mount=type=cache,target=/root/.bun/install/cache` on `bun install` steps so layer rebuilds reuse the package cache without inflating the image.
- **Production-only installs** — build stages that do not need dev dependencies run `bun install --frozen-lockfile --production`.
- **`.dockerignore`** — excludes `node_modules`, `dist`, `.git`, `docs`, `test-results`, and other non-source files to minimise the build context.
- **Final base image** — `gcr.io/distroless/cc-debian12` is kept. The Bun compiled binary links against `libc` and `libstdc++`, so `distroless/static` would crash. `cc` is the correct minimal variant.
- **Copy drizzle migrations** — `COPY --from=server-build /app/packages/server/drizzle ./packages/server/drizzle` is added to the final stage. `migrate.ts` resolves the migrations folder relative to `import.meta.dirname` at compile time; the SQL files must exist at that path in the container or startup will crash.
- **Multi-arch builds** — CI builds for `linux/amd64` and `linux/arm64` via Docker Buildx so self-hosters on ARM servers and Apple Silicon VMs get a native image.

---

## Database Migrations

Migrations must complete before the new server version serves traffic.

**Cloudflare:** A migration step runs against the appropriate Turso database before `wrangler deploy` in the workflow. The step executes `bun run packages/server/src/db/migrate.ts` directly with the target environment's `SQLITE_PATH` and `LIBSQL_AUTH_TOKEN` injected from GitHub Actions secrets.

**Docker Compose (self-hosted):** `packages/server/src/index.ts` imports `migrate.ts` at startup (before the HTTP server starts accepting connections) so migrations run automatically on `docker compose up`. Self-hosters running `docker compose pull && docker compose up -d` get migrations applied before traffic reaches the new version.

---

## CI/CD Workflows

Two new workflow files are added alongside the existing `ci.yml` and `release.yml`.

### `deploy-cloudflare.yml`

Triggers on push to `main`, on release tags (`v*`), and on PRs (open/update and closed). Quality checks in `ci.yml` run independently.

**Steps (PR open/update, push to `main`, release tag):**

1. `vp install` — install dependencies
2. `vp run build:client` — build client SPA to `packages/client/dist`
3. Run migrations against the target Turso DB (using `SQLITE_PATH` + `LIBSQL_AUTH_TOKEN` from secrets)
4. `vp exec wrangler deploy [--env <environment>] [--name <worker-name>]` — Wrangler bundles `worker.ts` and deploys Worker + assets (`vp exec` because `wrangler` is a devDependency)

**Per trigger:**

| Trigger            | Wrangler flags           | Action                                                 |
| ------------------ | ------------------------ | ------------------------------------------------------ |
| PR opened/updated  | `--name app-pr-{number}` | Deploy to named preview Worker, post URL as PR comment |
| PR closed          | —                        | Delete preview Worker (see below)                      |
| Push to `main`     | `--env nightly`          | Deploy to nightly environment                          |
| Release tag (`v*`) | `--env production`       | Deploy to production environment                       |

PR previews use `--name app-pr-{number}` (not `--env`) to deploy to a uniquely named Worker. Secrets for the preview Worker are injected immediately before the deploy step using a single `wrangler secret bulk --name app-pr-{number}` call — one bulk upload avoids the multiple Worker redeploys that sequential `secret put` calls would trigger. This avoids touching the `app` (default) or named environments.

#### PR Preview Cleanup

A separate `on: pull_request: types: [closed]` job in `deploy-cloudflare.yml` fires when a PR is closed. It calls `vp dlx wrangler delete --name app-pr-${{ github.event.pull_request.number }}` to remove the preview Worker and then destroys the per-PR Turso branch via the Turso CLI. The cleanup job uses `vp dlx` (not `vp exec`) so it can skip the full workspace install — it only needs a one-shot wrangler invocation. Without `--name`, Wrangler would use the `name` from `wrangler.toml` (`app`) and delete the wrong Worker.

### `build-docker.yml`

Triggers on push to `main` and on release tags (`v*`). Never runs on PRs.

- Runs on `ubuntu-latest` GitHub-hosted runners, matching the public repository CI baseline and avoiding any dependency on repository-specific runner labels.
- Logs into `ghcr.io` with `GITHUB_TOKEN`
- Sets up Docker Buildx for multi-arch builds
- Builds `linux/amd64,linux/arm64` in a single `docker buildx build --push`
- Uses GitHub Actions cache (`type=gha`) for BuildKit layer cache between runs

**Tag strategy:**

| Trigger              | Tags               |
| -------------------- | ------------------ |
| Push to `main`       | `nightly`          |
| Release tag `v1.2.3` | `latest`, `v1.2.3` |

### Relation to `release.yml`

The existing `release.yml` uses Changesets to cut release tags. Both new workflows listen for `on: push: tags: ['v*']` and fire automatically — no changes to `release.yml` are needed.

---

## Wrangler Configuration

A `wrangler.toml` at the repo root defines three environments. `nodejs_compat` is required for `node:async_hooks` used by the request context system. If TypeScript path aliases are added to `tsconfig`, they must be mirrored in a `[build.define]` or `alias` block in `wrangler.toml`.

```toml
name = "app"
main = "packages/server/src/worker.ts"
compatibility_date = "2026-04-01"
compatibility_flags = ["nodejs_compat"]

[assets]
directory = "./packages/client/dist"

# Default environment — used for PR previews.
# Secrets (SQLITE_PATH, LIBSQL_AUTH_TOKEN, BETTER_AUTH_SECRET, BETTER_AUTH_URL,
# ENCRYPTION_KEY, APP_EXTERNAL_URL) are injected via `wrangler secret put`
# in the workflow before each preview deploy.

[env.nightly]
name = "app-nightly"

[env.production]
name = "app-production"
```

Secrets for named environments are set once via `vp exec wrangler secret put --env <environment>` and are not re-uploaded on every deploy. For PR previews (default environment), the workflow injects all secrets in a single `vp exec wrangler secret bulk --name app-pr-{number}` call as part of each preview deploy step.

---

## Secrets & Configuration

### GitHub Actions Secrets

| Secret                         | Used by                 | Notes                                                                              |
| ------------------------------ | ----------------------- | ---------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`         | `deploy-cloudflare.yml` | Needs Workers + Assets deploy permissions                                          |
| `CLOUDFLARE_ACCOUNT_ID`        | `deploy-cloudflare.yml` | Required by Wrangler                                                               |
| `CLOUDFLARE_WORKERS_SUBDOMAIN` | `deploy-cloudflare.yml` | Account's `*.workers.dev` subdomain; used to build preview URLs                    |
| `TURSO_API_TOKEN`              | `deploy-cloudflare.yml` | Turso platform token; used by the Turso CLI to fork and destroy per-PR DB branches |
| `TURSO_URL_NIGHTLY`            | `deploy-cloudflare.yml` | Nightly Turso DB URL                                                               |
| `TURSO_AUTH_TOKEN_NIGHTLY`     | `deploy-cloudflare.yml` | Nightly Turso auth token                                                           |
| `TURSO_URL_PRODUCTION`         | `deploy-cloudflare.yml` | Production Turso DB URL                                                            |
| `TURSO_AUTH_TOKEN_PRODUCTION`  | `deploy-cloudflare.yml` | Production Turso auth token                                                        |
| `PREVIEW_BETTER_AUTH_SECRET`   | `deploy-cloudflare.yml` | Shared `BETTER_AUTH_SECRET` value injected into every preview Worker               |
| `PREVIEW_ENCRYPTION_KEY`       | `deploy-cloudflare.yml` | Shared `ENCRYPTION_KEY` value injected into every preview Worker                   |
| `GITHUB_TOKEN`                 | `build-docker.yml`      | Auto-provided; used for ghcr.io login                                              |

Each PR gets its own Turso branch (`nama-pr-<number>`) forked from `nama-nightly` on first deploy. Subsequent pushes to the same PR reuse the branch and let Drizzle migrations apply any schema delta. The branch is torn down by the cleanup job when the PR closes.

### Self-Hosted Configuration

Self-hosters copy `.env.example` to `.env`. The Docker Compose file loads it via `env_file`.

**`.env.example`:**

```
SQLITE_PATH=file:/data/nama.db
BETTER_AUTH_SECRET=changeme
BETTER_AUTH_URL=http://localhost:3000
ENCRYPTION_KEY=changeme
APP_EXTERNAL_URL=http://localhost:3000
```

---

## Docker Compose

```yaml
services:
  app:
    image: ghcr.io/org/app:latest
    env_file: .env
    ports:
      - "3000:3000"
    volumes:
      - app-data:/data

volumes:
  app-data:
```

---

## Rollback

**Cloudflare:** Wrangler keeps a deployment history per Worker. Roll back with:

```
vp exec wrangler rollback --env production
```

**Docker Compose (self-hosted):** Pin to a specific version tag rather than `latest` for rollback capability. To roll back, update the `image:` field in `docker-compose.yml` to the previous tag (e.g. `ghcr.io/org/app:v1.2.2`) and run `docker compose up -d`.

---

## New Files

| File                                      | Purpose                                                             |
| ----------------------------------------- | ------------------------------------------------------------------- |
| `packages/server/src/worker.ts`           | Cloudflare Workers entry point (Workers-compatible app composition) |
| `wrangler.toml`                           | Wrangler environment config                                         |
| `docker-compose.yml`                      | Self-hosted deployment                                              |
| `.env.example`                            | Self-hosted env var template                                        |
| `.dockerignore`                           | Build context exclusions                                            |
| `.github/workflows/deploy-cloudflare.yml` | Cloudflare deploy workflow                                          |
| `.github/workflows/build-docker.yml`      | Docker build and push workflow                                      |

## Modified Files

| File                               | Change                                                                                                                 |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `docker/Dockerfile`                | Add shared package copy, drizzle migrations copy in final stage, cache mounts, production installs, multi-arch support |
| `packages/server/src/index.ts`     | Import `migrate.ts` at startup before HTTP server starts                                                               |
| `packages/server/src/db/client.ts` | Skip `mkdirSync` for non-`file:` URLs; pass `LIBSQL_AUTH_TOKEN` to `createClient`                                      |
| `packages/server/src/env.ts`       | Add `LIBSQL_AUTH_TOKEN` (optional string)                                                                              |
