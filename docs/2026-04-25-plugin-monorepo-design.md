# Plugin Monorepo Packaging

**Status:** Draft for review
**Date:** 2026-04-25
**Author:** Omid Astaraki
**Supersedes:** N/A — extends the layout described in `docs/2026-04-19-plugin-architecture-design.md`. The runtime, capability, and database designs in that document remain authoritative; this document describes only how the same components are packaged across the workspace.

## Summary

Today every built-in plugin lives at `packages/server/src/plugins/builtin/<id>/plugin.ts` and is registered through a hardcoded import list. Plugin-author-facing types and helpers (`PluginContext`, `PluginError`, `definePlugin`, `handleHttpStatus`, …) are scattered across `packages/server/src/plugin-runtime/` and `packages/server/src/plugins/utils/`, where third-party plugin authors cannot reach them.

This refactor splits the monorepo so that each integration is its own publishable workspace package, introduces a dedicated `@ent-mcp/plugin-sdk` as the single dependency every plugin author imports, and reorganises the top of the tree into the conventional `apps/` (runnable) and `packages/` (publishable libraries) split. Each plugin package builds with tsdown into a single-file artifact (`dist/plugin.js`) for distribution and forward-compatibility with future third-party install, while built-ins continue to load via workspace TypeScript imports in dev and prod.

Versioning stays on Changesets with independent versions per package. Apps and publishable packages get GitHub Releases; `@ent-mcp/shared` stays internal-only.

## Goals

- Each integration (Trakt, TMDB, Plex, Jellyfin, Seerr, TVDB) lives in its own workspace package with independent versioning under Changesets.
- Move runnable applications under `apps/` and reusable libraries under `packages/` so the monorepo shape reflects what each artifact is for.
- `@ent-mcp/plugin-sdk` is the single dependency every plugin author imports — types, helpers, error class, capability schemas, validator, testing kit. Versioned with `manifest.sdkVersion` as the install-time gate.
- Each plugin builds to a single-file artifact via tsdown (`dist/plugin.js`), matching the shape third-party plugins will eventually be loaded as.
- Built-ins continue to load via workspace TS imports in dev and prod; the bundle artifact exists for distribution, inspection, and forward-compatibility, not for runtime loading.
- Plugin packages get their own GitHub Releases with bundle artifacts attached, pre-staging the third-party install path.

## Non-goals

- Third-party plugin install, QuickJS sandbox, hot reload, plugin marketplace — explicitly deferred per `docs/2026-04-19-plugin-architecture-design.md` and unchanged here.
- External publishing of plugin packages (they stay `private: false` for tagging but no npm publish; flipping to public is a one-line change later).
- Breaking the existing `PluginContext` / `CapabilityImpl` API — this is a packaging refactor, not an API redesign.
- Refactoring host-internal subsystems (jobs, runtime, registry, host-bridge) beyond what's needed to expose the SDK boundary.
- Splitting larger plugin source files (Plex/Jellyfin) into per-capability modules. Allowed but not required during the migration.

## Pre-flight dependencies

Two changes must merge before this work begins:

1. **PR [#107](https://github.com/electather/media-manager/pull/107)** — flips `client` and `server` to `private: false` so Changesets tags them and `changesets/action` produces GitHub Releases. The plugin packaging plan assumes this convention (`private: true` ⇒ no Release; `private: false` ⇒ tagged + Released).
2. **Issue [#106](https://github.com/electather/media-manager/issues/106)** — relocate `HOST_ERROR_CODES` and `HostErrorCode` from `apps/server/src/errors/codes.ts` to `@ent-mcp/shared/errors`. The SDK re-exports the type for plugin authors. Self-contained PR.

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

Two boundary rules, enforced by a CI lint check (see "Boundary enforcement" below):

1. **Plugins depend only on `@ent-mcp/plugin-sdk`.** Never on `@ent-mcp/shared`, never on `@ent-mcp/server`, never on each other. Anything a plugin needs must be re-exported from the SDK.
2. **`@ent-mcp/shared` stays free of plugin concerns.** Anything plugin-specific shared between client and server stays where it is today (`@ent-mcp/shared/plugins` for manifest schema, library types). The SDK _re-exports_ those for plugin authors but does not move them. Shared keeps its existing rule: isomorphic data shapes, zod-only runtime dep.

## `@ent-mcp/plugin-sdk` package contents

**Hard rule: every symbol has exactly one canonical home. The SDK either _owns_ a symbol (moved from somewhere else) or _re-exports_ it from `@ent-mcp/shared`. Nothing is duplicated.**

`@ent-mcp/shared` is internal to this monorepo (Bun workspace dep, never published). Third-party plugin authors can only depend on `@ent-mcp/plugin-sdk`. Shared types plugins need (manifest schema, error codes) reach plugin authors via SDK re-export, while shared remains the canonical source for first-party consumers.

### Source tree

```
packages/plugin-sdk/
  package.json
  tsconfig.json
  tsdown.config.ts
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

### Symbol map — what moves, what re-exports, what stays

> **Note on paths.** "Today's location" columns below use `apps/server/...` — i.e. they assume the `apps/` rename from commit 1 of the migration plan has been applied. Pre-rename, the same files live at `packages/server/...`. The relative paths inside server are unchanged.

#### MOVED (canonical home becomes SDK; deleted from original location)

| Symbol                                                                                                                                                                                                                                                                                                                                       | Today's location                                                                                                                                          | After                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PluginContext`, `PluginModule`, `AuthResult`, `CapabilityImpl`, `CapabilityMethod`, `PluginJobHandler`, `McpToolHandler`, `PluginLogger`, `PluginStoreApi`, `PoolSignalingApi`, `StoreScopeOpts`, `StoreSetOpts`                                                                                                                            | `apps/server/src/plugin-runtime/types.ts`                                                                                                                 | `packages/plugin-sdk/src/types.ts`. Server imports from SDK.                                                                                                                                                                              |
| `PluginError` class, `isPluginError`, `PluginErrorShape`                                                                                                                                                                                                                                                                                     | `apps/server/src/plugin-runtime/types.ts`                                                                                                                 | `packages/plugin-sdk/src/errors/plugin-error.ts`. Server imports from SDK.                                                                                                                                                                |
| `pluginError()` factory, `toErrorMessage`                                                                                                                                                                                                                                                                                                    | `apps/server/src/plugins/utils/plugin-error.ts`                                                                                                           | `packages/plugin-sdk/src/errors/plugin-error.ts`.                                                                                                                                                                                         |
| `handleHttpStatus`                                                                                                                                                                                                                                                                                                                           | `apps/server/src/plugins/utils/http-status.ts`                                                                                                            | `packages/plugin-sdk/src/utils/http-status.ts`.                                                                                                                                                                                           |
| `resolveCredential`                                                                                                                                                                                                                                                                                                                          | `apps/server/src/plugins/utils/credentials.ts`                                                                                                            | `packages/plugin-sdk/src/utils/credentials.ts`.                                                                                                                                                                                           |
| `definePlugin`, `defineCapability`, `method`                                                                                                                                                                                                                                                                                                 | `apps/server/src/plugin-runtime/define.ts`                                                                                                                | `packages/plugin-sdk/src/define.ts`. Server imports from SDK.                                                                                                                                                                             |
| `WatchHistoryV1`, `WatchlistV1`, `RatingsV1`, `RecommendationsV1`, `CalendarV1`, `PlaybackV1`, `CollectionV1`, `UserCommentsV1`, `IdResolveV1`, `MetadataV1`, `WatchProvidersV1`, `TrailersV1`, `MediaRequestV1`, `LibraryAvailabilityV1`, `ContinueWatchingV1`, `PlaybackSessionsV1`, `LibraryAdminV1`, plus the `CAPABILITY_CATALOG` index | `apps/server/src/plugin-runtime/capabilities.ts` (single file holding all capability `defineCapability(...)` exports plus the catalog and lookup helpers) | Split into `packages/plugin-sdk/src/capabilities/` directory: one file per capability plus an `index.ts` barrel that re-builds the catalog. Server's runtime imports the schemas from the SDK and registers each into its dispatch table. |
| `CapabilityDefinition`, `CapabilityMethodSpec`, `CapabilitySpec`, `CapabilityScopeMode`, `ResolvedCapabilityScope`, `CapabilityStrategy`, `CapabilityMcpTool`                                                                                                                                                                                | `apps/server/src/plugin-runtime/types.ts`                                                                                                                 | `packages/plugin-sdk/src/types.ts`.                                                                                                                                                                                                       |
| `validatePluginModule`                                                                                                                                                                                                                                                                                                                       | `apps/server/src/plugin-runtime/loader.ts`                                                                                                                | `packages/plugin-sdk/src/validate.ts`. Used by server boot AND contract tests.                                                                                                                                                            |
| `getCapability`, `listCapabilities` (catalog lookup helpers, currently in the same `capabilities.ts` file as the schemas above)                                                                                                                                                                                                              | `apps/server/src/plugin-runtime/capabilities.ts`                                                                                                          | `packages/plugin-sdk/src/capabilities/index.ts` — the lookup helpers move with the catalog they read.                                                                                                                                     |
| `SDK_VERSION` constant + `isSdkCompatible(range)`                                                                                                                                                                                                                                                                                            | `apps/server/src/plugin-runtime/manifest.ts` (`isSdkCompatible` only)                                                                                     | `packages/plugin-sdk/src/version.ts`. Server imports `isSdkCompatible` from SDK to gate installs.                                                                                                                                         |

#### RE-EXPORTED (canonical stays in `@ent-mcp/shared`)

These already cross the client/server boundary. They stay in shared (consumed by client UI, server validation, plugins via SDK).

| Symbol                                                                                         | Canonical home                                                 | SDK behaviour                                  |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------- |
| `pluginManifestSchema`, `PluginManifest` type                                                  | `packages/shared/src/plugins/schemas.ts` + `types.ts`          | Re-export from SDK for third-party access.     |
| `JSONSchema` type, `McpToolAnnotations`, library types under `@ent-mcp/shared/plugins/library` | `packages/shared/src/plugins/library.ts` + `types.ts`          | Re-export from SDK.                            |
| `HostErrorCode` union                                                                          | `packages/shared/src/errors/codes.ts` (after issue #106 lands) | Re-export from SDK.                            |
| Connection / job / preference enums plugins reference (lazy: add as plugins require them)      | `packages/shared/src/{jobs,connections,…}/enums.ts`            | Re-export only the ones plugins actually need. |

#### STAYS in server (not exported from SDK)

Host-internal subsystems plugins must never reach.

- `plugin-runtime/loader.ts` — `registerBuiltin`, `listBuiltins`, `getBuiltin`, `BuiltinSource` (uses SDK's `validatePluginModule` internally)
- `plugin-runtime/registry.ts` — in-memory dispatch index
- `plugin-runtime/runtime.ts` — invocation, retry, pool rotation
- `plugin-runtime/host-bridge.ts`, `fetch-policy.ts`, `allowed-hosts.ts`, `admin-policy.ts`, `shared-credentials.ts`, `user-pool.ts`, `context.ts` (the `buildContext` factory and its `BuildContextArgs`)
- The server-side capability _index_ (small file that imports SDK defs and calls `registerCapability(...)`) — only the registration glue lives here.

After the move, the existing `apps/server/src/plugins/` directory disappears: `builtin/` becomes workspace dependencies; `utils/` moves to the SDK.

### `@ent-mcp/plugin-sdk/testing` subpath

Test-only utilities. None of these exist anywhere today; they are extracted from duplicated helpers across the current `__tests__/` directories.

| Symbol                                                                 | Origin                                                                                  |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `makeTestContext(overrides)`                                           | New — extracted from `makeCtx` patterns duplicated across every plugin's contract test. |
| `jsonRes`, `statusRes`, `paginatedPage`, fetch response builders       | New — extracted from same.                                                              |
| Capability fixture builders (typed input builders for each capability) | New, optional, lazy.                                                                    |

`validatePluginModule` is **not** in `/testing` — it lives on the main entry because the server uses it at boot.

## Plugin package internal structure

Each `packages/plugins/<id>/` follows the same shape. Walking through `packages/plugins/trakt/`:

```
packages/plugins/trakt/
  package.json
  tsconfig.json
  tsdown.config.ts
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
    "build": "tsdown",
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

The `exports` conditional gives us "workspace import in dev with HMR, single-file bundle in prod" without two loader paths:

- `development` is resolved when `NODE_ENV=development` (or via `--conditions development`). Bun reads TS source directly via `vp dev`.
- `default` is resolved otherwise. The server's prod bundler treats plugin packages as external; each plugin's prebuilt bundle ships in the deploy artifact.

### `src/index.ts`

```ts
import { definePlugin } from "@ent-mcp/plugin-sdk";
// import implementation pieces
export default definePlugin({
  /* … */
});
```

### `tsdown.config.ts`

```ts
import { defineConfig } from "tsdown";
export default defineConfig({
  entry: "src/index.ts",
  format: "esm",
  dts: true,
  outDir: "dist",
  outputOptions: { entryFileNames: "plugin.js" },
  external: ["@ent-mcp/plugin-sdk"],
});
```

`external: ["@ent-mcp/plugin-sdk"]` is critical: the bundle does **not** inline the SDK. At runtime (workspace import in dev or `dist/plugin.js` in prod), the plugin and the server share a single SDK instance. Inlining would mean every plugin ships its own copy of `PluginError`, breaking `instanceof` checks. (`isPluginError` is duck-typed defensively _because_ of this risk, but a single shared instance is still preferable.)

A shared base config helper from `@ent-mcp/plugin-sdk/build` could DRY this up later; for v1 each plugin keeps its own copy.

## Server-side registration

The server's plugin loading collapses to a single small file:

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

Same shape as today — only the imports change from relative paths to package names.

### Capability registration

A single file mirrors plugin-side registration: imports capability defs from the SDK, pushes them into the dispatch registry.

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
  ]) {
    registerCapability(def);
  }
}
```

### Boot order in `apps/server/src/index.ts`

1. `registerHostCapabilities()` — fills the dispatch registry with capability defs from the SDK.
2. `registerBuiltinPlugins()` — registers each builtin module.
3. `bootstrapBuiltins()` (existing) — writes/refreshes `plugins` table rows from the in-memory registrations, computing the SDK-compat check via `isSdkCompatible(manifest.sdkVersion)`.

### Database checksum story

`bytes: 'builtin:${id}@${version}'` remains a synthetic identifier. With independent package versions the manifest version IS the package version, so a bump to `@ent-mcp/plugin-trakt@1.4.0` flows naturally to the synthetic string and triggers `bootstrapBuiltins` to refresh the row.

We do not hash `dist/plugin.js` for built-ins because dev mode resolves to TS source via the `development` export condition — there's no bundle for the server to read. A second code path that handles "no bundle yet" gracefully would re-introduce the divergence we're avoiding. When third-party plugins land later, that loader can hash actual JS files for content-addressed integrity without touching the built-in path.

## Testing strategy

| Layer                         | Location                                                       | Purpose                                                                                                                                                                                                                                                                                            |
| ----------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-plugin contract tests     | `packages/plugins/<id>/__tests__/contract.test.ts`             | Drive every declared capability method end-to-end with stubbed `PluginContext`; assert request URLs and parse results against the capability's Zod output schema. Imports `validatePluginModule`, `makeTestContext`, fetch helpers from `@ent-mcp/plugin-sdk/testing`. Today's pattern, relocated. |
| Per-plugin unit tests         | `packages/plugins/<id>/__tests__/plugin.test.ts`, `helpers.ts` | Plugin-internal coverage — auth ceremonies, edge cases, helpers. Today's pattern, relocated.                                                                                                                                                                                                       |
| Server-side integration tests | `apps/server/src/plugin-runtime/__tests__/`                    | Tests runtime, registry, host bridge, fetch policy. Doesn't touch individual plugins. Stays put.                                                                                                                                                                                                   |
| SDK self-tests                | `packages/plugin-sdk/__tests__/`                               | New — minimal coverage for `validatePluginModule`, `pluginError`, `handleHttpStatus`, `resolveCredential`, testing-kit fixtures.                                                                                                                                                                   |

`vp test` behaviour:

- Repo root: runs every package's tests in topological order. CI runs this.
- Inside a plugin directory: runs only that plugin's tests. Plugin-author inner loop.
- Inside the SDK: runs SDK self-tests.

## Versioning, releases, and `sdkVersion` enforcement

Independent versions per package. The `private` flag decides whether a package gets a GitHub Release page (per the convention from PR #107).

| Package                       | `private` | Tagged + GitHub Release? | Release artifacts                                                                                                          |
| ----------------------------- | --------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `@ent-mcp/server`             | `false`   | Yes                      | Docker image pushed to GHCR (`ghcr.io/electather/media-manager:<version>`), linked from Release notes; plus source archive |
| `@ent-mcp/client`             | `false`   | Yes                      | Built static bundle attached as Release asset (so self-hosters can serve it from any static host without rebuilding)       |
| `@ent-mcp/shared`             | `true`    | No                       | —                                                                                                                          |
| `@ent-mcp/plugin-sdk`         | `false`   | Yes                      | `dist/` tarball                                                                                                            |
| `@ent-mcp/plugin-<id>` (each) | `false`   | Yes                      | `dist/plugin.js` + `dist/plugin.d.ts` + manifest snapshot                                                                  |

Why per-plugin Releases: (a) the audit trail self-hosters actually want when reading "what changed in Trakt"; (b) pre-stages the third-party install path — when QuickJS sandboxing lands, the Release URL becomes the install URL with zero pipeline change; (c) `changesets/action` already creates Releases per non-private package, so the marginal cost is one workflow step that uploads `dist/*` as Release assets.

**How "no npm publish" is enforced.** The existing `.github/workflows/release.yml:38-40` runs `vp dlx changeset tag` as the `publish` step (not `vp dlx changeset publish`). `changeset tag` only creates git tags and (with `createGithubReleases: true`) GitHub Releases — it never calls `npm publish`. Flipping a package's `private` flag to `false` therefore makes it eligible for tagging and Releases without any risk of npm publication. This is the same mechanism PR [#107](https://github.com/electather/media-manager/pull/107) introduced for `client` and `server`; the SDK and plugin packages adopt the same pattern.

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

`updateInternalDependencies: "patch"` means a workspace dep bumping triggers a patch on every consumer — when `@ent-mcp/plugin-sdk` bumps, every plugin gets a patch automatically. Catches "forgot to bump a plugin's pinned SDK" at the changelog level. PR #107's pattern (flip `private` on packages you want released, leave it on the ones you don't) governs which packages get tagged; the SDK and plugin packages flip to `private: false`, shared stays `private: true`.

### Three changeset patterns to expect

```md
# A bug in one plugin only.

---

## "@ent-mcp/plugin-trakt": patch

Fix Trakt 401 retry loop after refresh.
```

```md
# An SDK change with downstream impact.

---

"@ent-mcp/plugin-sdk": minor
"@ent-mcp/plugin-trakt": patch
"@ent-mcp/plugin-tmdb": patch

---

Add `ctx.signal: AbortSignal` to PluginContext.
```

```md
# Pure server-side change.

---

## "@ent-mcp/server": minor

Wire AbortSignal into runtime invocation.
```

### `sdkVersion` enforcement — two layers

1. **Install-time gate.** `validatePluginModule` (now in SDK) calls `isSdkCompatible(manifest.sdkVersion)`. Server boot refuses incompatible plugins. (Existing behaviour, only the import path changes.)
2. **CI cross-check (new).** `scripts/check-sdk-compat.ts` verifies every plugin's `manifest.sdkVersion` semver-range parses against the SDK's current `package.json` version. Wired into `vp check`. Catches "bumped SDK major, forgot to widen plugin ranges."

### Baking the SDK version into the bundle

```ts
// packages/plugin-sdk/src/version.ts
export const SDK_VERSION = "__SDK_VERSION__"; // replaced by tsdown define
```

The SDK's `tsdown.config.ts` reads its own `package.json` version and substitutes via `define`. Single source of truth.

### Release workflow updates

Follow-on PR after #107 merges:

- After `changeset tag` runs, iterate over packages that got tagged, build them (`vp run build` per package), and upload `dist/*` as GitHub Release assets via `gh release upload`.
- For `@ent-mcp/server`: build the Docker image and **push to GitHub Container Registry (`ghcr.io/electather/media-manager:<version>`)**, then add a line to the Release notes linking the GHCR URL. Docker images are not attached as Release assets (oversized for the asset mechanism and GHCR is the conventional pull surface for self-hosters). The Docker build job itself is new — the existing `release.yml` does not build images today — so this commit also introduces the build/push step.
- For `@ent-mcp/client`: attach the built static bundle (`dist/`) as a Release asset so self-hosters can serve it from any static host without rebuilding.

## Boundary enforcement

`scripts/check-plugin-deps.ts` (or equivalent ESLint rule) fails CI if any file under `packages/plugins/` imports from `@ent-mcp/shared` or `@ent-mcp/server`. Plugins must reach those through `@ent-mcp/plugin-sdk` re-exports. Wired into `vp check`. This is the single rule that keeps the boundary honest as the codebase grows.

## Migration plan

Each commit is independently reviewable and leaves the repo in a working state.

### Commits

1. **Move apps to `apps/`.** Pure rename. `packages/client/` → `apps/client/`, `packages/server/` → `apps/server/`. Update root `package.json` workspaces glob, scripts, `vite.config.ts`, `wrangler.toml`, `docker/`, `.github/workflows/*`, any docs that reference old paths. Package names unchanged. No logic touched.
2. **Create `@ent-mcp/plugin-sdk` skeleton with relocated types and helpers.** New package at `packages/plugin-sdk/`. Move plugin-author types, `definePlugin`, `validatePluginModule`, `isSdkCompatible` + `SDK_VERSION`, `pluginError`, `handleHttpStatus`, `resolveCredential`. Update server imports. Plugins still live at `apps/server/src/plugins/builtin/` and import from the SDK now.
3. **Move capability schemas to the SDK.** Split `apps/server/src/plugin-runtime/capabilities.ts` (a single 870+ line file holding every `defineCapability(...)` export plus `CAPABILITY_CATALOG`, `getCapability`, `listCapabilities`) into `packages/plugin-sdk/src/capabilities/<capability>.ts` with a barrel `index.ts` that rebuilds the catalog and re-exports the lookup helpers. **Create** a new `apps/server/src/plugin-runtime/register-capabilities.ts` that imports each capability def from the SDK and calls `registerCapability(...)` to populate the runtime dispatch registry. Update plugin contract tests to import schemas and helpers from `@ent-mcp/plugin-sdk` instead of relative server paths.
4. **Create `@ent-mcp/plugin-sdk/testing` subpath.** Extract `makeTestContext`, `jsonRes`, `statusRes`, `paginatedPage` from duplicated patterns across `apps/server/src/plugins/builtin/*/__tests__/`. Plugin tests adopt the shared fixtures.
   5–10. **Extract one plugin per commit, smallest first.** Order: TVDB → TMDB → Seerr → Trakt → Plex → Jellyfin. For each: create `packages/plugins/<id>/` with `package.json`, `tsdown.config.ts`, `src/`, `__tests__/`; add `@ent-mcp/plugin-<id>` as dep in `apps/server/package.json`; update `registry.ts` to import from the new package; delete old `apps/server/src/plugins/builtin/<id>/` directory; write changeset (`@ent-mcp/plugin-<id>: minor` initial release + `@ent-mcp/server: patch` consumer update).
5. **Delete the husk.** Remove now-empty `apps/server/src/plugins/builtin/` and `apps/server/src/plugins/utils/` directories.
6. **Add the boundary lint check.** `scripts/check-plugin-deps.ts` failing on plugin-package imports from `@ent-mcp/shared` or `@ent-mcp/server`. Wired into `vp check`.
7. **Add the SDK-compat CI check.** `scripts/check-sdk-compat.ts` verifying every plugin's `manifest.sdkVersion` parses against the SDK's current version. Wired into `vp check`.
8. **Release workflow updates.** Adjust `.github/workflows/release.yml` to (a) build and attach `dist/plugin.js` + `dist/plugin.d.ts` as Release assets for each tagged plugin package, (b) build and attach the SDK's `dist/` tarball to its Release, (c) build and push the server Docker image to GHCR and link the pull URL from the `@ent-mcp/server` Release notes, and (d) build and attach the client static bundle as an asset on the `@ent-mcp/client` Release. The Docker build job itself is new — `release.yml` does not build images today.

### Risk & rollback

- Each commit is independently revertable. If an extraction goes wrong, `git revert <plugin-commit>` puts the source back at `apps/server/src/plugins/builtin/<id>/`.
- The boundary lint check (commit 12) is the rollback insurance for the design — it makes "import shared from a plugin" a CI failure, so the architecture cannot silently degrade in subsequent PRs.
- `bootstrapBuiltins` already handles version changes (existing DB row is refreshed when manifest version changes). Each plugin's first packaged release bumps its version (initial `0.1.0`), so existing rows naturally get refreshed on first deploy. No data migration needed.

### Estimated scope

~14 commits across 4–6 PRs (group 1+2, then 3+4, then plugin extractions in 1–2 PRs, then cleanup). Roughly 800–1500 lines of net change, mostly mechanical.

## Day-in-the-life

### Integration change (Trakt API adds an endpoint)

1. Edit `packages/plugins/trakt/src/plugin.ts` (or split files).
2. `cd packages/plugins/trakt && vp test` — tight loop.
3. `vp dev` from repo root — server reloads against the source via the `development` export condition. No rebuild required for HMR.
4. Write `.changeset/<slug>.md` naming `@ent-mcp/plugin-trakt`.
5. PR. CI runs full `vp check && vp test`.

### SDK change (add `ctx.signal: AbortSignal`)

1. Edit `packages/plugin-sdk/src/types.ts` and the runtime context builder in server.
2. Edit `apps/server/src/plugin-runtime/context.ts` to wire it in.
3. Update plugin types to use it (or not — additive change).
4. `vp typecheck` from root — catches every plugin that needs to widen its types.
5. Write a changeset naming `@ent-mcp/plugin-sdk` (minor) and any plugins that opt into the new field (patch).
6. CI's SDK-compat check verifies all plugin `sdkVersion` ranges still satisfy the new SDK version.

## Future hooks

- **Third-party plugin install.** When QuickJS sandboxing lands, third-party plugins fetch a `dist/plugin.js` URL (likely a GitHub Release asset of a public plugin repo built with the same `@ent-mcp/plugin-sdk` external dep) and load it through a sandbox-aware loader. Built-ins continue on the workspace import path. Two loaders, one capability registry, one validator.
- **Public plugin authoring.** When an external author wants to publish a plugin, the SDK is already set up to be installed from npm (`private: false`, no internal-only re-exports beyond what shared owns). Flipping `access: "public"` on the SDK and publishing it is the only step.
- **Per-capability source splits.** Plex/Jellyfin already exceed 1100 lines as single files. Splitting `src/capabilities/<cap>.ts` per capability is non-blocking; can be done in any plugin's own follow-up commit without touching the SDK or other plugins.

## References

- `docs/2026-04-19-plugin-architecture-design.md` — runtime, capability model, database schema. Authoritative for everything in this document does not redefine.
- PR [#107](https://github.com/electather/media-manager/pull/107) — release-page convention dependency.
- Issue [#106](https://github.com/electather/media-manager/issues/106) — `HOST_ERROR_CODES` relocation pre-flight dependency.
