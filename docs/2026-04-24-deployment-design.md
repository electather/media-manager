# Deployment Design

**Date:** 2026-04-24
**Status:** Draft

## Overview

This document describes the deployment strategy for the media-manager monorepo. Two independent deployment targets share the same application code but differ in runtime and infrastructure:

- **Cloudflare** — hosted deployment using Cloudflare Workers + Assets
- **Docker Compose** — self-hosted deployment using a single compiled container

---

## Architecture

### Cloudflare (Hosted)

The Hono server runs as a Cloudflare Worker. The React SPA (static export) is served via Wrangler's `[assets]` binding — Cloudflare serves static files from its CDN edge and only forwards unmatched requests to the Worker. There is no SSR; the client is a pure static export.

The database is Turso (hosted libSQL), accessed over HTTP using the existing `@libsql/client`. No code changes are required — only the `LIBSQL_URL` and `LIBSQL_AUTH_TOKEN` env vars differ between environments.

A new file `packages/server/src/worker.ts` exports the Hono app as a default export — the only addition needed for Workers compatibility. All business logic remains in a shared `app.ts` imported by both entry points.

**Environments:**

| Environment | Trigger | URL |
|---|---|---|
| Production | Release tag | `app.example.com` |
| Nightly | Push to `main` | `nightly.app.example.com` |
| PR Preview | PR open/update | `app-pr-{number}.account.workers.dev` |

PR preview Workers are deleted when the PR is closed.

### Docker Compose (Self-Hosted)

A single container runs the compiled Hono server binary, which also serves the client's static files from disk. SQLite is stored in a named Docker volume mounted at `/data`. No other services are required.

Images are published to `ghcr.io` with two rolling tags:

| Git event | Tags pushed |
|---|---|
| Push to `main` | `ghcr.io/org/app:nightly` |
| Release tag `v1.2.3` | `ghcr.io/org/app:latest`, `ghcr.io/org/app:v1.2.3` |

PR branches do not produce Docker images.

---

## Dockerfile Optimisations

The existing `docker/Dockerfile` is updated with the following improvements:

- **Fix shared package copy** — `packages/shared` source files are copied in every build stage that depends on `@ent-mcp/shared`. The current Dockerfile omits this, which would break the workspace dependency resolution.
- **BuildKit cache mounts** — `--mount=type=cache,target=/root/.bun/install/cache` on `bun install` steps so layer rebuilds reuse the package cache without inflating the image.
- **Production-only installs** — build stages that do not need dev dependencies run `bun install --frozen-lockfile --production`.
- **`.dockerignore`** — excludes `node_modules`, `dist`, `.git`, `docs`, `test-results`, and other non-source files to minimise the build context.
- **Final base image** — `gcr.io/distroless/cc-debian12` is kept. The Bun compiled binary links against `libc` and `libstdc++`, so `distroless/static` would crash. `cc` is the correct minimal variant.
- **Multi-arch builds** — CI builds for `linux/amd64` and `linux/arm64` via Docker Buildx so self-hosters on ARM servers and Apple Silicon VMs get a native image.

---

## CI/CD Workflows

Two new workflow files are added alongside the existing `ci.yml` and `release.yml`.

### `deploy-cloudflare.yml`

Triggers on push to `main`, on release tags, and on PRs. Quality checks in `ci.yml` run independently.

**Steps (all triggers):**
1. `vp install` — install dependencies
2. `vp build` — build client SPA to `packages/client/dist`
3. `vp dlx wrangler deploy` — deploy Worker + assets

**Per trigger:**

| Trigger | Wrangler env | Action |
|---|---|---|
| PR opened/updated | _(default)_ | Deploy `app-pr-{number}`, post preview URL as PR comment |
| PR closed | — | Delete preview Worker via Wrangler API |
| Push to `main` | `nightly` | Deploy to nightly environment |
| Release tag | `production` | Deploy to production environment |

### `build-docker.yml`

Triggers on push to `main` and on release tags. Never runs on PRs.

- Runs on `ubuntu-latest` (GitHub-hosted runner — Docker Buildx is not available on the self-hosted runners)
- Logs into `ghcr.io` with the auto-provided `GITHUB_TOKEN`
- Sets up Docker Buildx for multi-arch builds
- Builds `linux/amd64,linux/arm64` in a single `docker buildx build --push`
- Uses GitHub Actions cache (`type=gha`) for BuildKit layer cache between runs

**Tag strategy:**

| Trigger | Tags |
|---|---|
| Push to `main` | `nightly` |
| Release tag `v1.2.3` | `latest`, `v1.2.3` |

### Relation to `release.yml`

The existing `release.yml` uses Changesets to cut release tags. Both new workflows listen for those tags and fire automatically — no changes to `release.yml` are needed.

---

## Wrangler Configuration

A `wrangler.toml` at the repo root defines three environments:

```toml
name = "app"
main = "packages/server/src/worker.ts"
compatibility_date = "2025-01-01"

[assets]
directory = "./packages/client/dist"

[env.nightly]
name = "app-nightly"

[env.nightly.vars]
ENVIRONMENT = "nightly"

[env.production]
name = "app-production"

[env.production.vars]
ENVIRONMENT = "production"
```

Secrets (`LIBSQL_URL`, `LIBSQL_AUTH_TOKEN`, `BETTER_AUTH_SECRET`) are set once per environment via `vp dlx wrangler secret put --env <environment>` and are not re-uploaded on every deploy.

---

## Secrets & Configuration

### GitHub Actions Secrets

| Secret | Used by | Notes |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | `deploy-cloudflare.yml` | Needs Workers + Assets deploy permissions |
| `CLOUDFLARE_ACCOUNT_ID` | `deploy-cloudflare.yml` | Required by Wrangler |
| `TURSO_URL_NIGHTLY` | `deploy-cloudflare.yml` | Nightly Turso DB URL |
| `TURSO_AUTH_TOKEN_NIGHTLY` | `deploy-cloudflare.yml` | Nightly Turso auth token |
| `TURSO_URL_PRODUCTION` | `deploy-cloudflare.yml` | Production Turso DB URL |
| `TURSO_AUTH_TOKEN_PRODUCTION` | `deploy-cloudflare.yml` | Production Turso auth token |
| `GITHUB_TOKEN` | `build-docker.yml` | Auto-provided; used for ghcr.io login |

PR preview Workers use a shared Turso preview database — one database for all previews, not one per PR.

### Self-Hosted Configuration

Self-hosters copy `.env.example` to `.env`. The Docker Compose file loads it via `env_file`.

**`.env.example`:**
```
LIBSQL_URL=file:/data/app.db
BETTER_AUTH_SECRET=changeme
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

## New Files

| File | Purpose |
|---|---|
| `packages/server/src/worker.ts` | Cloudflare Workers entry point |
| `wrangler.toml` | Wrangler environment config |
| `docker-compose.yml` | Self-hosted deployment |
| `.env.example` | Self-hosted env var template |
| `.dockerignore` | Build context exclusions |
| `.github/workflows/deploy-cloudflare.yml` | Cloudflare deploy workflow |
| `.github/workflows/build-docker.yml` | Docker build and push workflow |

## Modified Files

| File | Change |
|---|---|
| `docker/Dockerfile` | Add shared package copy, cache mounts, production installs, multi-arch support |
