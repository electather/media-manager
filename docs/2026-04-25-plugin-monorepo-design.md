# Plugin Monorepo Packaging

**Status:** Draft for review
**Date:** 2026-04-25
**Author:** Omid Astaraki
**Supersedes:** N/A — extends layout in `docs/2026-04-19-plugin-architecture-design.md`. Runtime, capability, database designs there stay authoritative; this doc cover only packaging across workspace.

## Summary

Today every built-in plugin live at `packages/server/src/plugins/builtin/<id>/plugin.ts`, registered via hardcoded import list. Plugin-author types and helpers (`PluginContext`, `PluginError`, `definePlugin`, `handleHttpStatus`, …) scattered across `packages/server/src/plugin-runtime/` and `packages/server/src/plugins/utils/` — third-party authors cannot reach.

Refactor split monorepo: each integration own publishable workspace package, new `@ent-mcp/plugin-sdk` as single dep every plugin author imports, top of tree reorganised into conventional `apps/` (runnable) + `packages/` (publishable libs) split. Each plugin package build with `vp pack` (Vite+'s tsdown wrapper) into single-file artifact (`dist/plugin.js`) for distribution + forward-compat with future third-party install. Built-ins keep loading via workspace TS imports in dev + prod.

Versioning stay on Changesets, independent versions per package. Apps + publishable packages get GitHub Releases; `@ent-mcp/shared` internal-only.

## Goals

- Each integration (Trakt, TMDB, Plex, Jellyfin, Seerr, TVDB) own workspace package, independent versioning under Changesets.
- Move runnable apps under `apps/`, reusable libs under `packages/` so monorepo shape reflect artifact purpose.
- `@ent-mcp/plugin-sdk` = single dep every plugin author import — types, helpers, error class, capability schemas, validator, testing kit. Versioned with `manifest.sdkVersion` as install-time gate.
- Each plugin build single-file artifact via `vp pack` (`dist/plugin.js`), match shape third-party plugins eventually load as.
- Built-ins keep loading via workspace TS imports in dev + prod; bundle artifact for distribution, inspection, forward-compat — not runtime loading.
- Plugin packages get own GitHub Releases with bundle assets, pre-stage third-party install path.

## Non-goals

- Third-party install, QuickJS sandbox, hot reload, marketplace — deferred per `docs/2026-04-19-plugin-architecture-design.md`, unchanged.
- External publishing of plugin packages (stay `private: false` for tagging, no npm publish; flip to public = one-line later).
- Breaking existing `PluginContext` / `CapabilityImpl` API — packaging refactor, not API redesign.
- Refactoring host-internal subsystems (jobs, runtime, registry, host-bridge) past what SDK boundary needs.
- Splitting bigger plugin sources (Plex/Jellyfin) into per-capability modules. Allowed, not required during migration.

## Pre-flight dependencies

Two changes must merge first:

1. **PR [#107](https://github.com/electather/media-manager/pull/107)** — flip `client` and `server` to `private: false` so Changesets tag them and `changesets/action` produce GitHub Releases. Plan assume convention (`private: true` ⇒ no Release; `private: false` ⇒ tagged + Released).
2. **Issue [#106](https://github.com/electather/media-manager/issues/106)** — relocate `HOST_ERROR_CODES` and `HostErrorCode` from `apps/server/src/errors/codes.ts` to `@ent-mcp/shared/errors`. SDK re-exports type for plugin authors. Self-contained PR.

## Architecture

### Target layout

```
apps/
  client/                     @ent-mcp/client       (private: false, never npm-published; Cloudflare Assets bundle)
  server/                     @ent-mcp/server       (private: false, never npm-published; Docker image release artifact)
packages/
  shared/                     @ent-mcp/shared       (private: true; isomorphic types/schemas, no runtime deps besides zod)
  plugin-sdk/                 @ent-mcp/plugin-sdk   (private: false; plugin author API + testing kit)
  plugins/
    trakt/                    @ent-mcp/plugin-trakt
    tmdb/                     @ent-mcp/plugin-tmdb
    plex/                     @ent-mcp/plugin-plex
    jellyfin/                 @ent-mcp/plugin-jellyfin
    seerr/                    @ent-mcp/plugin-seerr
    tvdb/                     @ent-mcp/plugin-tvdb
```

Workspace globs in root `package.json`:

```json
"workspaces": ["apps/*", "packages/*", "packages/plugins/*"]
```

### Dependency graph (acyclic)

```
apps/client    ──► packages/shared
apps/server    ──► packages/shared
               ──► packages/plugin-sdk
               ──► packages/plugins/* (each one explicitly)
packages/plugin-sdk ──► packages/shared
packages/plugins/*  ──► packages/plugin-sdk
                    ──► (no dep on shared, no dep on server, no cross-plugin deps)
```

Two boundary rules, enforced by CI lint check (see "Boundary enforcement"):

1. **Plugins depend only on `@ent-mcp/plugin-sdk`.** Never on `@ent-mcp/shared`, never on `@ent-mcp/server`, never on each other. Anything plugin needs must re-export from SDK.
2. **`@ent-mcp/shared` stay free of plugin concerns.** Plugin-specific stuff shared between client + server stay where it is (`@ent-mcp/shared/plugins` for manifest schema, library types). SDK _re-exports_ for plugin authors but does not move. Shared keep existing rule: isomorphic data shapes, zod-only runtime dep.

## `@ent-mcp/plugin-sdk` package contents

**Hard rule: every symbol = exactly one canonical home. SDK either _owns_ symbol (moved from elsewhere) or _re-exports_ from `@ent-mcp/shared`. Nothing duplicated.**

`@ent-mcp/shared` internal to monorepo (Bun workspace dep, never published). Third-party plugin authors only depend on `@ent-mcp/plugin-sdk`. Shared types plugins need (manifest schema, error codes) reach plugin authors via SDK re-export, while shared stay canonical source for first-party consumers.

### Source tree

```
packages/plugin-sdk/
  package.json
  tsconfig.json
  vite.config.ts          # configures vp pack via the `pack` block
  src/
    index.ts                 main entry — author-facing runtime API
    testing/
      index.ts               testing-kit entry — fixtures, response helpers
    define.ts                definePlugin, defineCapability, method
    types.ts                 PluginContext, PluginModule, AuthResult, CapabilityImpl, …
    errors/
      plugin-error.ts        PluginError class + pluginError() factory + toErrorMessage
    utils/
      http-status.ts         handleHttpStatus
      credentials.ts         resolveCredential
    capabilities/
      index.ts               capability schema definitions (WatchHistoryV1, IdResolveV1, …)
    validate.ts              validatePluginModule (used by server boot AND contract tests)
    version.ts               SDK_VERSION constant + isSdkCompatible(range)
    manifest.ts              re-exports pluginManifestSchema and PluginManifest from @ent-mcp/shared
```

### `package.json` exports

```json
{
  "name": "@ent-mcp/plugin-sdk",
  "version": "0.1.0",
  "private": false,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./testing": "./src/testing/index.ts"
  },
  "dependencies": {
    "@ent-mcp/shared": "workspace:*",
    "zod": "catalog:"
  }
}
```

Unlike plugin packages (use `development`/`default`/`types` conditional, see below), SDK exports always resolve to TS source. Server runs from source via Bun in dev + prod, SDK never loads as pre-built bundle, so `dist/` condition add code path nothing reads. When SDK gain npm distribution, that the moment to add `default` condition pointing at built artifact — not before.

### Symbol map — what moves, what re-exports, what stays

> **Note on paths.** "Today's location" columns below use `apps/server/...` — assume `apps/` rename from commit 1 of migration plan applied. Pre-rename, same files live at `packages/server/...`. Relative paths inside server unchanged.

#### MOVED (canonical home becomes SDK; deleted from original location)

| Symbol                                                                                                                                                                                                                                                                                                                                       | Today's location                                                                                                                                          | After                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PluginContext`, `PluginModule`, `AuthResult`, `CapabilityImpl`, `CapabilityMethod`, `PluginJobHandler`, `McpToolHandler`, `PluginLogger`, `PluginStoreApi`, `PoolSignalingApi`, `StoreScopeOpts`, `StoreSetOpts`                                                                                                                            | `apps/server/src/plugin-runtime/types.ts`                                                                                                                 | `packages/plugin-sdk/src/types.ts`. Server imports from SDK.                                                                                                                                                                              |
| `PluginError` class, `isPluginError`, `PluginErrorShape`                                                                                                                                                                                                                                                                                     | `apps/server/src/plugin-runtime/types.ts`                                                                                                                 | `packages/plugin-sdk/src/errors/plugin-error.ts`. Server imports from SDK.                                                                                                                                                                |
| `pluginError()` factory, `toErrorMessage`                                                                                                                                                                                                                                                                                                    | `apps/server/src/plugins/utils/plugin-error.ts`                                                                                                           | `packages/plugin-sdk/src/errors/plugin-error.ts`.                                                                                                                                                                                         |
| `handleHttpStatus`                                                                                                                                                                                                                                                                                                                           | `apps/server/src/plugins/utils/http-status.ts`                                                                                                            | `packages/plugin-sdk/src/utils/http-status.ts`.                                                                                                                                                                                           |
| `resolveCredential`                                                                                                                                                                                                                                                                                                                          | `apps/server/src/plugins/utils/credentials.ts`                                                                                                            | `packages/plugin-sdk/src/utils/credentials.ts`.                                                                                                                                                                                           |
| `definePlugin`, `defineCapability`, `method`                                                                                                                                                                                                                                                                                                 | `apps/server/src/plugin-runtime/define.ts`                                                                                                                | `packages/plugin-sdk/src/define.ts`. Server imports from SDK.                                                                                                                                                                             |
| `WatchHistoryV1`, `WatchlistV1`, `RatingsV1`, `RecommendationsV1`, `CalendarV1`, `PlaybackV1`, `CollectionV1`, `UserCommentsV1`, `IdResolveV1`, `MetadataV1`, `WatchProvidersV1`, `TrailersV1`, `MediaRequestV1`, `LibraryAvailabilityV1`, `ContinueWatchingV1`, `PlaybackSessionsV1`, `LibraryAdminV1`, plus `CAPABILITY_CATALOG` index | `apps/server/src/plugin-runtime/capabilities.ts` (single file holding all capability `defineCapability(...)` exports plus catalog and lookup helpers) | Split into `packages/plugin-sdk/src/capabilities/` directory: one file per capability plus `index.ts` barrel that rebuilds catalog. Server runtime imports schemas from SDK, registers each into dispatch table. |
| `CapabilityDefinition`, `CapabilityMethodSpec`, `CapabilitySpec`, `CapabilityScopeMode`, `ResolvedCapabilityScope`, `CapabilityStrategy`, `CapabilityMcpTool`                                                                                                                                                                                | `apps/server/src/plugin-runtime/types.ts`                                                                                                                 | `packages/plugin-sdk/src/types.ts`.                                                                                                                                                                                                       |
| `validatePluginModule`                                                                                                                                                                                                                                                                                                                       | `apps/server/src/plugin-runtime/loader.ts`                                                                                                                | `packages/plugin-sdk/src/validate.ts`. Used by server boot AND contract tests.                                                                                                                                                            |
| `getCapability`, `listCapabilities` (catalog lookup helpers, currently in same `capabilities.ts` file as schemas above)                                                                                                                                                                                                              | `apps/server/src/plugin-runtime/capabilities.ts`                                                                                                          | `packages/plugin-sdk/src/capabilities/index.ts` — lookup helpers move with catalog they read.                                                                                                                                     |
| `SDK_VERSION` constant + `isSdkCompatible(range)`                                                                                                                                                                                                                                                                                            | `apps/server/src/plugin-runtime/manifest.ts` (`isSdkCompatible` only)                                                                                     | `packages/plugin-sdk/src/version.ts`. Server imports `isSdkCompatible` from SDK to gate installs.                                                                                                                                         |

#### RE-EXPORTED (canonical stays in `@ent-mcp/shared`)

These already cross client/server boundary. Stay in shared (consumed by client UI, server validation, plugins via SDK).

| Symbol                                                                                         | Canonical home                                                 | SDK behaviour                                  |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------- |
| `pluginManifestSchema`, `PluginManifest` type                                                  | `packages/shared/src/plugins/schemas.ts` + `types.ts`          | Re-export from SDK for third-party access.     |
| `JSONSchema` type, `McpToolAnnotations`, library types under `@ent-mcp/shared/plugins/library` | `packages/shared/src/plugins/library.ts` + `types.ts`          | Re-export from SDK.                            |
| `HostErrorCode` union                                                                          | `packages/shared/src/errors/codes.ts` (after issue #106 lands) | Re-export from SDK.                            |
| Connection / job / preference enums plugins reference (lazy: add as plugins require)      | `packages/shared/src/{jobs,connections,…}/enums.ts`            | Re-export only ones plugins actually need. |

#### STAYS in server (not exported from SDK)

Host-internal subsystems plugins must never reach.

- `plugin-runtime/loader.ts` — `registerBuiltin`, `listBuiltins`, `getBuiltin`, `BuiltinSource` (uses SDK's `validatePluginModule` internally)
- `plugin-runtime/registry.ts` — in-memory dispatch index
- `plugin-runtime/runtime.ts` — invocation, retry, pool rotation
- `plugin-runtime/host-bridge.ts`, `fetch-policy.ts`, `allowed-hosts.ts`, `admin-policy.ts`, `shared-credentials.ts`, `user-pool.ts`, `context.ts` (`buildContext` factory + `BuildContextArgs`)
- Server-side capability _index_ (small file imports SDK defs, calls `registerCapability(...)`) — only registration glue here.

After move, existing `apps/server/src/plugins/` directory disappears: `builtin/` becomes workspace deps; `utils/` moves to SDK.

### `@ent-mcp/plugin-sdk/testing` subpath

Test-only utilities. None exist anywhere today; extracted from duplicated helpers across current `__tests__/` directories.

| Symbol                                                                 | Origin                                                                                  |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `makeTestContext(overrides)`                                           | New — extracted from `makeCtx` patterns duplicated across every plugin's contract test. |
| `jsonRes`, `statusRes`, `paginatedPage`, fetch response builders       | New — extracted from same.                                                              |
| Capability fixture builders (typed input builders for each capability) | New, optional, lazy.                                                                    |

`validatePluginModule` **not** in `/testing` — lives on main entry because server uses at boot.

## Plugin package internal structure

Each `packages/plugins/<id>/` follow same shape. Walk through `packages/plugins/trakt/`:

```
packages/plugins/trakt/
  package.json
  tsconfig.json
  vite.config.ts           # configures vp pack via the `pack` block
  CHANGELOG.md             # generated by Changesets
  src/
    index.ts               # entry — exports plugin module via definePlugin
    plugin.ts              # implementation (today's content of builtin/trakt/plugin.ts, minus relative imports)
    capabilities/          # optional split when implementations grow large (Plex/Jellyfin already at 1100+ lines)
      watch-history.ts
      watchlist.ts
      ...
    auth.ts                # optional split for auth ceremony
  __tests__/
    contract.test.ts       # uses @ent-mcp/plugin-sdk/testing
    plugin.test.ts         # plugin-internal unit tests
  dist/                    # build output, gitignored
    plugin.js              # single-file bundle — the future third-party install shape
    plugin.d.ts            # types for IDE tooling and downstream consumers
```

### `package.json`

```json
{
  "name": "@ent-mcp/plugin-trakt",
  "version": "0.1.0",
  "private": false,
  "type": "module",
  "exports": {
    ".": {
      "development": "./src/index.ts",
      "default": "./dist/plugin.js",
      "types": "./dist/plugin.d.ts"
    }
  },
  "scripts": {
    "build": "vp pack",
    "typecheck": "tsc --noEmit",
    "test": "vp test"
  },
  "dependencies": {
    "@ent-mcp/plugin-sdk": "workspace:*"
  },
  "devDependencies": {
    "typescript": "catalog:",
    "vite-plus": "catalog:",
    "vitest": "catalog:"
  }
}
```

`exports` conditional give "workspace import in dev with HMR, single-file bundle in prod" without two loader paths:

- `development` resolved when `NODE_ENV=development` (or `--conditions development`). Bun read TS source direct via `vp dev`.
- `default` resolved otherwise. Server prod bundler treat plugin packages external; each plugin prebuilt bundle ship in deploy artifact.

### `src/index.ts`

```ts
import { definePlugin } from "@ent-mcp/plugin-sdk";
// import implementation pieces
export default definePlugin({
  /* … */
});
```

### `vite.config.ts`

Vite+ wrap tsdown via `vp pack`; per Vite+ migration guide, packaging options live in `pack` block of `vite.config.ts`, not standalone `tsdown.config.ts`. No direct `tsdown` import or devDependency — `vite-plus` provide wrapper.

```ts
import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: "src/index.ts",
    format: "esm",
    dts: true,
    outDir: "dist",
    outputOptions: { entryFileNames: "plugin.js" },
    external: ["@ent-mcp/plugin-sdk"],
  },
});
```

`external: ["@ent-mcp/plugin-sdk"]` critical: bundle does **not** inline SDK. At runtime (workspace import in dev or `dist/plugin.js` in prod), plugin + server share single SDK instance. Inlining mean every plugin ship own copy of `PluginError`, breaking `instanceof` checks. (`isPluginError` duck-typed defensively _because_ of risk, but single shared instance still preferable.)

Shared base config helper from `@ent-mcp/plugin-sdk/build` could DRY this later; v1 each plugin keep own copy.

## Server-side registration

Server plugin loading collapse to one small file:

```ts
// apps/server/src/plugins/registry.ts
import { registerBuiltin } from "../plugin-runtime/loader";
import traktPlugin from "@ent-mcp/plugin-trakt";
import tmdbPlugin from "@ent-mcp/plugin-tmdb";
import plexPlugin from "@ent-mcp/plugin-plex";
import jellyfinPlugin from "@ent-mcp/plugin-jellyfin";
import seerrPlugin from "@ent-mcp/plugin-seerr";
import tvdbPlugin from "@ent-mcp/plugin-tvdb";

const BUILTIN_PLUGINS = [
  traktPlugin,
  tmdbPlugin,
  plexPlugin,
  jellyfinPlugin,
  seerrPlugin,
  tvdbPlugin,
];

export function registerBuiltinPlugins(): void {
  for (const module of BUILTIN_PLUGINS) {
    registerBuiltin({
      id: module.manifest.id,
      module,
      bytes: `builtin:${module.manifest.id}@${module.manifest.version}`,
    });
  }
}
```

Same shape as today — only imports change from relative paths to package names.

### Capability registration

Single file mirror plugin-side registration: import capability defs from SDK, push into dispatch registry.

```ts
// apps/server/src/plugin-runtime/register-capabilities.ts
import {
  WatchHistoryV1,
  WatchlistV1,
  RatingsV1,
  RecommendationsV1,
  CalendarV1,
  PlaybackV1,
  CollectionV1,
  UserCommentsV1,
  IdResolveV1,
  MetadataV1,
  WatchProvidersV1,
  TrailersV1,
  MediaRequestV1,
  LibraryAvailabilityV1,
  ContinueWatchingV1,
  PlaybackSessionsV1,
  LibraryAdminV1,
} from "@ent-mcp/plugin-sdk";
import { registerCapability } from "./registry";

export function registerHostCapabilities(): void {
  for (const def of [
    WatchHistoryV1,
    WatchlistV1,
    RatingsV1,
    RecommendationsV1,
    CalendarV1,
    PlaybackV1,
    CollectionV1,
    UserCommentsV1,
    IdResolveV1,
    MetadataV1,
    WatchProvidersV1,
    TrailersV1,
    MediaRequestV1,
    LibraryAvailabilityV1,
    ContinueWatchingV1,
    PlaybackSessionsV1,
    LibraryAdminV1,
  ]) {
    registerCapability(def);
  }
}
```

### Boot order in `apps/server/src/index.ts`

1. `registerHostCapabilities()` — fill dispatch registry with capability defs from SDK.
2. `registerBuiltinPlugins()` — register each builtin module.
3. `bootstrapBuiltins()` (existing) — write/refresh `plugins` table rows from in-memory registrations, compute SDK-compat check via `isSdkCompatible(manifest.sdkVersion)`.

### Database checksum story

`bytes: 'builtin:${id}@${version}'` stay synthetic identifier. With independent package versions, manifest version IS package version, so bump to `@ent-mcp/plugin-trakt@1.4.0` flow naturally to synthetic string and trigger `bootstrapBuiltins` to refresh row.

No hash of `dist/plugin.js` for built-ins because dev mode resolve to TS source via `development` export condition — no bundle for server to read. Second code path handling "no bundle yet" gracefully would re-introduce divergence we avoid. When third-party plugins land later, that loader can hash actual JS files for content-addressed integrity without touching built-in path.

## Testing strategy

| Layer                         | Location                                                       | Purpose                                                                                                                                                                                                                                                                                            |
| ----------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-plugin contract tests     | `packages/plugins/<id>/__tests__/contract.test.ts`             | Drive every declared capability method end-to-end with stubbed `PluginContext`; assert request URLs and parse results against capability Zod output schema. Imports `validatePluginModule`, `makeTestContext`, fetch helpers from `@ent-mcp/plugin-sdk/testing`. Today's pattern, relocated. |
| Per-plugin unit tests         | `packages/plugins/<id>/__tests__/plugin.test.ts`, `helpers.ts` | Plugin-internal coverage — auth ceremonies, edge cases, helpers. Today's pattern, relocated.                                                                                                                                                                                                       |
| Server-side integration tests | `apps/server/src/plugin-runtime/__tests__/`                    | Test runtime, registry, host bridge, fetch policy. Doesn't touch individual plugins. Stay put.                                                                                                                                                                                                  |
| SDK self-tests                | `packages/plugin-sdk/__tests__/`                               | New — minimal coverage for `validatePluginModule`, `pluginError`, `handleHttpStatus`, `resolveCredential`, testing-kit fixtures.                                                                                                                                                                   |

`vp test` behaviour:

- Repo root: run every package tests in topological order. CI run this.
- Inside plugin directory: run only that plugin tests. Plugin-author inner loop.
- Inside SDK: run SDK self-tests.

## Versioning, releases, and `sdkVersion` enforcement

Independent versions per package. `private` flag decide whether package get GitHub Release page (per convention from PR #107).

| Package                       | `private` | Tagged + GitHub Release? | Release artifacts                                                                                                          |
| ----------------------------- | --------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `@ent-mcp/server`             | `false`   | Yes                      | Docker image pushed to GHCR (`ghcr.io/electather/media-manager:<version>`), linked from Release notes; plus source archive |
| `@ent-mcp/client`             | `false`   | Yes                      | Built static bundle attached as Release asset (so self-hosters can serve from any static host without rebuilding)       |
| `@ent-mcp/shared`             | `true`    | No                       | —                                                                                                                          |
| `@ent-mcp/plugin-sdk`         | `false`   | Yes                      | `dist/` tarball                                                                                                            |
| `@ent-mcp/plugin-<id>` (each) | `false`   | Yes                      | `dist/plugin.js` + `dist/plugin.d.ts` + manifest snapshot                                                                  |

Why per-plugin Releases: (a) audit trail self-hosters actually want when reading "what changed in Trakt"; (b) pre-stage third-party install path — when QuickJS sandboxing land, Release URL become install URL, zero pipeline change; (c) `changesets/action` already create Releases per non-private package, so marginal cost = one workflow step uploading `dist/*` as Release assets.

**How "no npm publish" enforced.** Existing `.github/workflows/release.yml:38-40` run `vp dlx changeset tag` as `publish` step (not `vp dlx changeset publish`). `changeset tag` only create git tags + (with `createGithubReleases: true`) GitHub Releases — never call `npm publish`. Flipping package `private` flag to `false` therefore make eligible for tagging + Releases without risk of npm publication. Same mechanism PR [#107](https://github.com/electather/media-manager/pull/107) introduced for `client` + `server`; SDK + plugin packages adopt same pattern.

### Changesets config

```json
{
  "$schema": "https://unpkg.com/@changesets/config@2.3.1/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "restricted",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "privatePackages": false
}
```

`updateInternalDependencies: "patch"` mean workspace dep bump trigger patch on every consumer — when `@ent-mcp/plugin-sdk` bump, every plugin get patch automatic. Catch "forgot to bump plugin pinned SDK" at changelog level. PR #107 pattern (flip `private` on packages to release, leave on rest) govern which packages get tagged; SDK + plugin packages flip to `private: false`, shared stay `private: true`.

### Three changeset patterns to expect

Bug in one plugin only:

```md
---
"@ent-mcp/plugin-trakt": patch
---

Fix Trakt 401 retry loop after refresh.
```

SDK change with downstream impact:

```md
---
"@ent-mcp/plugin-sdk": minor
"@ent-mcp/plugin-trakt": patch
"@ent-mcp/plugin-tmdb": patch
---

Add `ctx.signal: AbortSignal` to PluginContext.
```

Pure server-side change:

```md
---
"@ent-mcp/server": minor
---

Wire AbortSignal into runtime invocation.
```

### `sdkVersion` enforcement — two layers

1. **Install-time gate.** `validatePluginModule` (now in SDK) call `isSdkCompatible(manifest.sdkVersion)`. Server boot refuse incompatible plugins. (Existing behaviour, only import path changes.)
2. **CI cross-check (new).** `scripts/check-sdk-compat.ts` verify every plugin `manifest.sdkVersion` semver-range parse against SDK current `package.json` version. Wired into `vp check`. Catch "bumped SDK major, forgot to widen plugin ranges."

### Baking the SDK version into the bundle

```ts
// packages/plugin-sdk/src/version.ts
export const SDK_VERSION = "__SDK_VERSION__"; // replaced at build time
```

SDK `vite.config.ts` read own `package.json` version + substitute via `pack.define` option (forwarded to tsdown). Single source of truth.

### Release workflow updates

Follow-on PR after #107 merges:

- After `changeset tag` runs, iterate over packages tagged, build them (`vp run build` per package), upload `dist/*` as GitHub Release assets via `gh release upload`.
- For `@ent-mcp/server`: build Docker image + **push to GitHub Container Registry (`ghcr.io/electather/media-manager:<version>`)**, then add line to Release notes linking GHCR URL. Docker images not attached as Release assets (oversized for asset mechanism, GHCR = conventional pull surface for self-hosters). Docker build job itself new — existing `release.yml` does not build images today — so this commit also introduce build/push step.
- For `@ent-mcp/client`: attach built static bundle (`dist/`) as Release asset so self-hosters can serve from any static host without rebuilding.

## Boundary enforcement

`scripts/check-plugin-deps.ts` (or equivalent ESLint rule) fail CI if any file under `packages/plugins/` import from `@ent-mcp/shared` or `@ent-mcp/server`. Plugins must reach those through `@ent-mcp/plugin-sdk` re-exports. Wired into `vp check`. Single rule keeps boundary honest as codebase grows.

## Migration plan

Each commit independently reviewable, leave repo in working state.

### Commits

1. **Move apps to `apps/`.** Pure rename. `packages/client/` → `apps/client/`, `packages/server/` → `apps/server/`. Update root `package.json` workspaces glob, scripts, `vite.config.ts`, `wrangler.toml`, `docker/`, `.github/workflows/*`, any docs reference old paths. Package names unchanged. No logic touched.
2. **Create `@ent-mcp/plugin-sdk` skeleton with relocated types and helpers.** New package at `packages/plugin-sdk/`. Move plugin-author types, `definePlugin`, `validatePluginModule`, `isSdkCompatible` + `SDK_VERSION`, `pluginError`, `handleHttpStatus`, `resolveCredential`. Update server imports. Plugins still live at `apps/server/src/plugins/builtin/` and import from SDK now.
3. **Move capability schemas to the SDK.** Split `apps/server/src/plugin-runtime/capabilities.ts` (single 870+ line file holding every `defineCapability(...)` export plus `CAPABILITY_CATALOG`, `getCapability`, `listCapabilities`) into `packages/plugin-sdk/src/capabilities/<capability>.ts` with barrel `index.ts` rebuilds catalog + re-exports lookup helpers. **Create** new `apps/server/src/plugin-runtime/register-capabilities.ts` imports each capability def from SDK + calls `registerCapability(...)` to populate runtime dispatch registry. Update plugin contract tests to import schemas + helpers from `@ent-mcp/plugin-sdk` instead of relative server paths.
4. **Create `@ent-mcp/plugin-sdk/testing` subpath.** Extract `makeTestContext`, `jsonRes`, `statusRes`, `paginatedPage` from duplicated patterns across `apps/server/src/plugins/builtin/*/__tests__/`. Plugin tests adopt shared fixtures.
5. **Extract `@ent-mcp/plugin-tvdb`.** First plugin extraction — smallest blast radius first. Apply per-plugin template (see below), ship as one commit.
6. **Extract `@ent-mcp/plugin-tmdb`.** Same template.
7. **Extract `@ent-mcp/plugin-seerr`.** Same template.
8. **Extract `@ent-mcp/plugin-trakt`.** Same template.
9. **Extract `@ent-mcp/plugin-plex`.** Same template.
10. **Extract `@ent-mcp/plugin-jellyfin`.** Same template — biggest, intentionally last so earlier extractions de-risk pattern.
11. **Delete the husk.** Remove now-empty `apps/server/src/plugins/builtin/` and `apps/server/src/plugins/utils/` directories.
12. **Add the boundary lint check.** `scripts/check-plugin-deps.ts` failing on plugin-package imports from `@ent-mcp/shared` or `@ent-mcp/server`. Wired into `vp check`.
13. **Add the SDK-compat CI check.** `scripts/check-sdk-compat.ts` verify every plugin `manifest.sdkVersion` parse against SDK current version. Wired into `vp check`.
14. **Release workflow updates.** Adjust `.github/workflows/release.yml` to (a) build + attach `dist/plugin.js` + `dist/plugin.d.ts` as Release assets for each tagged plugin package, (b) build + attach SDK `dist/` tarball to its Release, (c) build + push server Docker image to GHCR + link pull URL from `@ent-mcp/server` Release notes, (d) build + attach client static bundle as asset on `@ent-mcp/client` Release. Docker build job itself new — `release.yml` does not build images today.

**Per-plugin extraction template (commits 5–10).** For each `<id>` in TVDB, TMDB, Seerr, Trakt, Plex, Jellyfin: create `packages/plugins/<id>/` with `package.json`, `vite.config.ts`, `src/`, `__tests__/`; add `@ent-mcp/plugin-<id>` as dep in `apps/server/package.json`; update `registry.ts` to import from new package; delete old `apps/server/src/plugins/builtin/<id>/` directory; write changeset (`@ent-mcp/plugin-<id>: minor` initial release + `@ent-mcp/server: patch` consumer update).

### Risk & rollback

- Each commit independently revertable. If extraction goes wrong, `git revert <plugin-commit>` put source back at `apps/server/src/plugins/builtin/<id>/`.
- Boundary lint check (commit 12) = rollback insurance for design — make "import shared from plugin" a CI failure, so architecture cannot silently degrade in subsequent PRs.
- `bootstrapBuiltins` already handle version changes (existing DB row refreshed when manifest version changes). Each plugin first packaged release bump version (initial `0.1.0`), so existing rows naturally refresh on first deploy. No data migration needed.

### Estimated scope

~14 commits across 4–6 PRs (group 1+2, then 3+4, then plugin extractions in 1–2 PRs, then cleanup). Roughly 800–1500 lines of net change, mostly mechanical.

## Day-in-the-life

### Integration change (Trakt API adds an endpoint)

1. Edit `packages/plugins/trakt/src/plugin.ts` (or split files).
2. `cd packages/plugins/trakt && vp test` — tight loop.
3. `vp dev` from repo root — server reload against source via `development` export condition. No rebuild for HMR.
4. Write `.changeset/<slug>.md` naming `@ent-mcp/plugin-trakt`.
5. PR. CI run full `vp check && vp test`.

### SDK change (add `ctx.signal: AbortSignal`)

1. Edit `packages/plugin-sdk/src/types.ts` and runtime context builder in server.
2. Edit `apps/server/src/plugin-runtime/context.ts` to wire in.
3. Update plugin types to use (or not — additive change).
4. `vp typecheck` from root — catch every plugin needs to widen types.
5. Write changeset naming `@ent-mcp/plugin-sdk` (minor) + any plugins opt into new field (patch).
6. CI SDK-compat check verify all plugin `sdkVersion` ranges still satisfy new SDK version.

## Future hooks

- **Third-party plugin install.** When QuickJS sandboxing land, third-party plugins fetch `dist/plugin.js` URL (likely GitHub Release asset of public plugin repo built with same `@ent-mcp/plugin-sdk` external dep) + load through sandbox-aware loader. Built-ins stay on workspace import path. Two loaders, one capability registry, one validator.
- **Public plugin authoring.** When external author want to publish plugin, SDK already set up to install from npm (`private: false`, no internal-only re-exports beyond what shared owns). Flip `access: "public"` on SDK + publish = only step.
- **Per-capability source splits.** Plex/Jellyfin already exceed 1100 lines as single files. Split `src/capabilities/<cap>.ts` per capability non-blocking; can do in any plugin own follow-up commit without touching SDK or other plugins.

## References

- `docs/2026-04-19-plugin-architecture-design.md` — runtime, capability model, database schema. Authoritative for everything this doc does not redefine.
- PR [#107](https://github.com/electather/media-manager/pull/107) — release-page convention dependency.
- Issue [#106](https://github.com/electather/media-manager/issues/106) — `HOST_ERROR_CODES` relocation pre-flight dependency.