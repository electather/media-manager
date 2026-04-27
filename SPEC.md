# SPEC — ent-mcp

## §G Goal

Personal entertainment management platform. MCP server (Streamable HTTP) + React dashboard. Agents & users discover, request, track, rate media. Plugin system fan-out to external services (Trakt, Plex, TMDB, …). Two deploy targets: Cloudflare Workers (hosted) + Docker (self-hosted).

## §C Constraints

- C1. No ML deps. Preference engine pure weighted-feature scoring.
- C2. No external error export by default. Error capture self-hosted (SQLite).
- C3. No sandbox in v1. Built-in plugins run as trusted TS modules in-process.
- C4. No npm publish. Packages `private: false` for Changesets/GitHub Releases only.
- C5. No product analytics. Error capture ≠ funnel tracking.
- C6. Cloudflare Workers runtime: no `croner` scheduler, no `node:fs`, no serveStatic. Excluded from `worker.ts`.
- C7. `@ent-mcp/shared` isomorphic — only `zod` runtime dep. No drizzle, no hono, no plugin imports.
- C8. Plugins depend only on `@ent-mcp/plugin-sdk`. Never on `@ent-mcp/shared` direct, never on server, never on each other.
- C9. Credentials never logged, never stored plaintext. AES-256-GCM at rest.
- C10. Preference engine host-owned. No plugin surface, no outbound calls.

## §I Interfaces

### I.api — hono rpc procedures (authenticated users)

- `connections.*` — list/create/update/delete user connections + test
- `plugins.*` — admin: list/configure plugins, shared-creds pool, advanced admin
- `activity.*` — watch history, watchlist, ratings
- `requests.*` — media download requests
- `discover.*` — search + preference-ranked discovery
- `preferences.*` — profile read + feedback log
- `errors.*` — admin error viewer
- `jobs.*` — admin job list + trigger
- `users.*` / `roles.*` — admin user + role management
- `me.*` — authorized apps, data export, account delete
- `config.public` — `{ emailEnabled: boolean }` (unauthenticated)
- `notifications.*` — inbox CRUD + channel subscription settings

### I.mcp — MCP tools (OAuth 2.1 JWT, Streamable HTTP)

- `ent_discover` — search / browse / recommend media
- `ent_details` — metadata + user state for single item
- `ent_request` — submit download request
- `ent_activity` — watch history + watchlist + ratings read/write
- `ent_feedback` — explicit taste signal
- `ent_account` — connected plugins + capabilities summary
- `ext_*` — plugin-contributed tools (namespaced per plugin)

### I.plugin — Plugin SDK (`@ent-mcp/plugin-sdk`)

Capabilities versioned: `metadata@v1`, `watchHistory@v1`, `watchlist@v1`, `ratings@v1`, `recommendations@v1`, `calendar@v1`, `mediaRequest@v1`, `idResolve@v1` (mixed-scope), `userComments@v1`, `watchProviders@v1`, `trailers@v1`, `playback@v1`, `collection@v1`, `libraryAvailability@v1`, `playbackSessions@v1`, `continueWatching@v1`, `libraryAdmin@v1`, `notificationDelivery@v1`.
Auth kinds: `form` | `oauth_redirect` | `oauth_device` | `none`.
Scope: `global` (admin creds, shared pool) | `user` (per-connection creds) | `mixed` (`idResolve@v1` — classifier routes per input).
`ctx.fetch` — single network surface; gated by manifest allowlist + admin allowlist intersection.
`ctx.notify(event)` — emit notification to owning user.
`ctx.store` — plugin-scoped KV, namespaced by `(pluginId, userId, key)`.
`ctx.log` — structured logger; tagged with `requestId`.
`ctx.pool.markExhausted({ retryAfterSec? })` — signal host current credential rate-limited; host rotates + retries within same call.
`ctx.appBaseUrl` — host external URL (`APP_EXTERNAL_URL`); plugins build OAuth `redirect_uri` from this only.

### I.deploy — deployment

- CF: `worker.ts` entry, Turso DB, Wrangler, multi-env (`app` / `app-nightly` / `app-pr-{n}`).
- Docker: compiled Bun binary + static client, SQLite volume `/data`, `ghcr.io` images (`nightly` / `latest` / `v*`).
- Migrations run pre-deploy (CF) or at startup (Docker).

### I.notifications — notification events (v1)

Events: `job.run.failed`, `connection.auth.expired`, `connection.sync.succeeded`, `media.request.available`, `media.request.denied`, `system.error`.
Channels: `inbox` (built-in, host-privileged), `ntfy`, `telegram`, `discord`.
Categories: `media` | `sync` | `auth` | `system`. Category→permission map in `NOTIFICATION_CATEGORY_PERMISSION`.
Delivery: per-row `notification_deliveries` table, CAS lock (`pending→in_progress`), exponential retry `[60s, 5m, 30m, 2h, 12h]` capped 6 total attempts. Stale-pending sweep every 5 min.
Subscription captured at emit time. Already-queued delivery fires even if user disables subscription after emit.
HTTP user: `/api/notifications/{inbox,channels,subscriptions,plugins,categories}`.
HTTP admin: `/api/admin/notifications/{deliveries,settings}`.
Shared schemas + event registry: `@ent-mcp/shared/notifications`.

### I.home — home feed procedures

- `home.getLayout` → `HomeLayoutResponse { hero: LayoutHero|null, rows: HomeRow[], generatedAt }`.
- `home.getRowContent(rowId, cursor)` → `RowContentResponse { items, cursor, partial? }`.
  Seven row kinds: `continueWatching`, `recommendedForYou`, `trendingNow`, `newReleases`, `becauseYouWatched`, `upcomingForYou`, `yourWatchlist`.
  `LayoutHero { item: CompactMediaItem, source: RowKind, reason, resumeUrl: string|null }`. `resumeUrl` null = ⊥ playable; consumer ! `!= null` check (empty-string truthy = wrong).
  `HomeRow.titleOverride` set when hero exclusion shifts row meaning.
  Error codes: `home.bad_input` (invalid rowId/cursor), `home.row_unavailable` (row no longer eligible mid-session — frontend drops row + toasts), `home.internal` (captured infra fault).

## §V Invariants

- V1. `MediaService` sole facade for plugin features. MCP tools + Hono RPC + jobs call `MediaService`; nothing below it (runtime, registry, credentials) is reachable from callers.
- V2. Every `ctx.fetch` call goes through `buildFetch` in `fetch-policy.ts`. Hostname checked against `manifest.allowedHosts ∩ adminAllowlist`; blocked calls recorded to error sink with code `plugin.host_blocked_by_admin`; plugin sees `plugin.upstream_error`.
- V3. `adminAllowlist = null` → inherit manifest (no narrowing). `adminAllowlist = []` → block all static hosts (dynamic `x-allowed-host` still pass).
- V4. Admin headers injected after allowlist check; `adminHeaders` values decrypted in memory per invocation only; never written to logs.
- V5. Error codes live in registry (`errors/codes.ts`). Severity from registry; callsite override allowed; unknown code defaults to `error`. Over-capture preferred over silent drop.
- V6. Every error tagged `requestId` (UUID). Frontend generates per-call; backend reads header or generates; propagated to plugin via `ctx.log`.
- V7. Shared credentials encrypted AES-256-GCM. Ciphertext + IV stored as separate base64 columns. Plaintext lives in memory only for single `buildContext` invocation.
- V8. Preference engine pure function of profile + candidates. No tracking of what was shown to user. `match_reason` falls out of scoring bookkeeping.
- V9. Layout decisions in `rules.ts` are pure functions of `LayoutSignals`. No DB access, no plugin calls inside layout logic.
- V10. Row fetchers access only `RowFetchContext` (MediaService + PreferenceEngine + dataloader). Plugin runtime, credentials, raw DB are out of reach.
- V11. `becauseYouWatched` seed threaded through opaque cursor. Fetcher reads seed from cursor always; never branches on "cursor null → look up elsewhere." `RowFetchContext` does not expose signal snapshot.
- V12. `@ent-mcp/shared` has no runtime deps besides `zod`. Any symbol crossing server/client boundary lives in shared. Drizzle tables, server-internal interfaces stay on server.
- V13. `notifications.emit()` sole entry point for notification dispatch. All call sites (job runner hooks, `ctx.notify()`, server modules) go through it. Delivery durable: every dispatch persisted + retried on transient fail.
- V14. User-facing connections list excludes pure-global plugins (those with no `userScopedCapabilities`). Pure-global plugin surface is admin-only.
- V15. Home feed cursors Zod-validated before any business logic. Malformed base64, version mismatch, rowId mismatch, oversized fields → `home.bad_input`. Zod rejects before allocation to prevent crafted-cursor DoS.
- V16. Hero pipeline order: fetch all rows → `resolveHero` → `applyHeroExclusion` → `dropEmpty` → wire shape. `applyHeroExclusion` runs before `dropEmpty` so rows emptied by hero exclusion are still dropped.
- V17. RBAC double-gated on notifications. UI hides categories user lacks permission for. `resolveRecipients()` re-checks permission before writing delivery row. Both gates required — defense in depth.
- V18. Delivery handler acquires row via CAS: `UPDATE notification_deliveries SET status='in_progress' WHERE id=:id AND status='pending'`. Zero rows → exit immediately, no duplicate `deliver()` call. Stale `in_progress` rows (>2 min) reset to `pending` by sweep every 5 min.
- V19. v2 bus migration zero-footprint on callers. `emit()` signature, all call sites, all plugin code, all DB tables, full HTTP surface unchanged. Only `emit()` body replaced by `bus.publish()`. Zero call-site changes required.
- V20. Plugin bundles declare `@ent-mcp/plugin-sdk` as `pack.external`. SDK ⊥ inlined — single shared instance required; `instanceof PluginError` across server/plugin boundary breaks if each plugin ships own copy.
- V21. Plugin packages use conditional exports: `development` → `src/index.ts` (Bun resolves TS), `default` → `dist/plugin.js`, `types` → `dist/plugin.d.ts`. ⊥ "bundle not yet built" fallback — dev always TS source, prod always prebuilt.
- V22. `scripts/check-plugin-deps.ts` wired into `vp check`; CI fails if any file under `packages/plugins/*` imports from `@ent-mcp/shared` or `@ent-mcp/server` directly. Plugins reach those only via SDK re-exports.
- V23. `scripts/check-sdk-compat.ts` wired into `vp check`; CI fails if any plugin `manifest.sdkVersion` semver range does not satisfy current SDK `package.json` version. Catches "bumped SDK major, forgot to widen plugin ranges."
- V24. `personalKeyFallback` fallback always scoped to requesting user. Admin-pool pick per-user-request only; ⊥ cross-user credential mixing ever.
- V25. Connection create rejected when validated creds payload resolves to empty object for plugin with `credentialsSchema`. ⊥ parked connections.
- V26. `idResolve@v1` scope classifier: `from` ∋ `:` → `"user"` scope; else → `"global"`. Classifier called once per dispatch; result threads through both provider lookup and cache key. Server-local handles ⊥ pollute global cache.
- V27. OAuth 2.1 JWT validated before MCP tool dispatch. ∀ tool handler unreachable w/o valid token. Auth check ∈ transport layer; runs before tool routing — ⊥ handler reachable unauthenticated.
- V28. `config.public` sole unauthenticated endpoint. ∀ other routes & procedures → valid session | JWT required. ⊥ accidental info leak when adding new routes.
- V29. `me.accountDelete` cascades ∀ user-owned rows: connections, `notification_deliveries`, preferences, activity, watchlist, ratings, feedback, errors. ⊥ orphaned user data post-deletion.
- V30. Row presentation single source = `ROW_DISPLAY` map at `packages/client/src/lib/home-display.ts`. ∀ row-specific visual decisions (slot, aspectRatio, showMatchReasonInline) read from it. ⊥ row-id branching elsewhere in page tree. Adding row = one entry; rest of code untouched.
- V31. Single `Card` component. Treatment dispatch from item shape: progress→continue-watching, episode→upcoming, neither→default. Aspect from `ROW_DISPLAY[rowId].aspectRatio`. Size from `@container` query (hero/row/sidebar). ⊥ duplicate card variants.
- V32. Modal open uses `router.navigate({ search, replace: false })` (push). Close uses default `replace: true` (rewrite). Net: one browser-back dismisses modal + lands on prior page. Inverting either breaks history flow — back-press would skip past modal or stack two entries.
- V33. Cards render as `<a href={`/media/${id}`}>`. Click handler `preventDefault` + sets `peek` search param; modifier-clicks (middle / Cmd / Ctrl) fall through to real URL. ⊥ `<button>` — breaks open-in-new-tab + share.
- V34. `MediaDetailModal` mounted at `_authenticated` layout — ⊥ home route. ∀ authed routes get peek-modal free. `peekSchema` declared on route `validateSearch`; invalid stripped before reaching component. ⊥ defensive parsing inside modal.
- V35. Sidebar→main slot override at narrow widths via `@container` query, ⊥ `useMediaQuery`. Hydration-safe when SSR lands. `clearLogo` overlay rendered only at hero container size; ⊥ at row/sidebar sizes (title text rules there).
- V36. Frontend treats `HomeRow.cursor` + `getRowContent` cursor opaque. ⊥ parse, ⊥ inspect, ⊥ version-check. Backend owns format per V15.
- V37. CatalogService sole owner of `canonical_metadata`, `discover_snapshots`, `recommendation_lists`, `user_history_mirror`, `user_ratings_mirror`. Row fetchers, MediaService, plugins ⊥ touch those tables direct.
- V38. Catalog writes via jobs only. Serve path ⊥ write catalog except bounded cold-fill on `PreferenceEngine.getItemFeatures` miss (metric tracked).
- V39. User history + ratings mirrors append-only. Sync job ⊥ delete events. Plugin = source of truth; mirror = read projection for rebuild + serve.
- V40. Watchlist ⊥ mirrored. ∀ watchlist read via MediaService live plugin dispatch.
- V41. `id_map` ⊥ denormalized onto `canonical_metadata`. Cross-provider IDs read via JOIN through `Catalog.getMetadataWithIds`. ⊥ duplicate ID writers.
- V42. Discover snapshots keyed `(feed_kind, sort, day)`, `day = floor(now / DAY_MS) * DAY_MS`. Day-rounded for stable cache key.
- V43. `recommendation_lists.profile_version` bumps on profile rebuild. Stale rec list → eligible for rebuild trigger; ⊥ served as fresh.
- V44. Single canonical artwork URL per kind on `canonical_metadata` (`poster_url`, `backdrop_url`, `clear_logo_url`, `thumb_url`). Plugin live fetch ⊥ on serve unless column NULL.
- V45. `PreferenceEngine.getItemFeatures` reads from `canonical_metadata.features`. ⊥ `skipCache: true` plugin path. Miss → cold-fill writes back to catalog.
- V46. Canon art (`poster|backdrop|clear_logo|thumb_url`) ← merge `metadata@v1.getDetails` ⊕ `artwork@v1.getArtwork` via `Promise.allSettled`. Sites: cold-fill (`CatalogPreferenceProvider`) ∧ refresh job (`host.catalog.metadata_refresh`). Pick `bundle.<kind>[0]?.url ?? null` (host-merged by `providerPriority`). `artwork@v1` fail (incl `artwork.unsupported_id_combo`, dispatcher fault) ⊥ block metadata write; absent kinds = null. 2-pass: 1st (fresh tmdbId, empty `id_map`) → poster/backdrop only; 2nd (post-`idResolve@v1`) → logos/thumbs.
- V47. FE reads `CompactMediaItem.{poster,backdrop,clearLogo}` 1st. `artwork.get` RPC ⇔ inline = null (cold-fill path for pre-catalog items). ⊥ unconditional per-row RPC.

## §T Tasks

| id  | status | desc                                                                                                                                                                                                                                                                                                                  | cites                                      |
| --- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| T1  | ✓      | Plugin architecture — manifest, capabilities, scope, dispatch                                                                                                                                                                                                                                                         | I.plugin                                   |
| T2  | ✓      | Plugin monorepo layout — `apps/`, `packages/plugins/*`, plugin-sdk                                                                                                                                                                                                                                                    | I.plugin,C8                                |
| T3  | ✓      | MediaService + TMDB reference plugin (`metadata@v1`)                                                                                                                                                                                                                                                                  | I.api,V1                                   |
| T4  | ✓      | MCP server — 6 tools, OAuth 2.1, dispatcher, registry                                                                                                                                                                                                                                                                 | I.mcp,V1                                   |
| T5  | ✓      | Error management — capture, codes, correlation, admin viewer                                                                                                                                                                                                                                                          | V5,V6                                      |
| T6  | ✓      | Job service — 4 kinds, scheduler, run-logger, admin UI                                                                                                                                                                                                                                                                | I.api                                      |
| T7  | ✓      | Preference engine — scoring, incremental update, rebuild job                                                                                                                                                                                                                                                          | V8,C1                                      |
| T8  | ✓      | Connections backend + manifest-driven frontend (`/settings/connections`)                                                                                                                                                                                                                                              | I.api,I.plugin                             |
| T9  | ✓      | Plugin advanced admin — host allowlist + custom headers                                                                                                                                                                                                                                                               | V2,V3,V4,I.api                             |
| T10 | ✓      | Notifications — emit, delivery job, inbox + ntfy/telegram/discord                                                                                                                                                                                                                                                     | I.notifications,V15                        |
| T11 | ✓      | User settings (5 tabs: profile/security/connections/apps/danger)                                                                                                                                                                                                                                                      | I.api                                      |
| T12 | ✓      | Deployment — CF Workers `worker.ts`, Docker, CI workflows                                                                                                                                                                                                                                                             | I.deploy,C6                                |
| T13 | ✓      | Home feed server — `HomeFeedService`, 7 row fetchers, 2 procedures                                                                                                                                                                                                                                                    | I.home,V9,V10,V11,V12                      |
| T14 | x      | Home feed frontend — route, single-source `ROW_DISPLAY`, single `Card`, layout-level peek modal                                                                                                                                                                                                                       | I.home,T13,T16,V30,V31,V32,V33,V34,V35,V36 |
| T15 | ✓      | `home` subpath export in `@ent-mcp/shared`                                                                                                                                                                                                                                                                            | V12,T13                                    |
| T16 | .      | Decide `resumeUrl` capability: `watchHistory@v1` ext vs new `playback@v1`                                                                                                                                                                                                                                             | I.home,T13                                 |
| T17 | .      | `@ent-mcp/plugin-sdk/testing` — `makeTestContext`, fetch helpers, fixtures from contract tests                                                                                                                                                                                                                        | C8,V23                                     |
| T18 | .      | Per-plugin extraction — TVDB, TMDB, Seerr, Trakt, Plex, Jellyfin → `packages/plugins/<id>/`; delete builtin/ husk                                                                                                                                                                                                     | C8,V22,V23,V24                             |
| T19 | .      | Boundary lint + SDK-compat CI checks wired into `vp check`                                                                                                                                                                                                                                                            | V24,V25                                    |
| T20 | .      | Release workflow — GHCR Docker push (server), `dist/*` assets on plugin + SDK GitHub Releases                                                                                                                                                                                                                         | I.deploy                                   |
| T21 | x      | Per-`Row` error boundary — bad item / unhandled card render error hides single row, ⊥ crash whole feed                                                                                                                                                                                                                | T14                                        |
| T22 | x      | `CenteredState` primitive shared by `home-feed-empty` + `home-feed-error` (title + body + action button)                                                                                                                                                                                                              | T14                                        |
| T23 | x      | Carousel keyboard pattern — arrows out of Tab order; cards in Tab; `ArrowLeft`/`Right` scroll within row                                                                                                                                                                                                              | T14                                        |
| T24 | x      | Progress-bar color token `--color-progress-watched`; ⊥ reuse `--color-text-danger` (text role on non-text surface)                                                                                                                                                                                                    | T14                                        |
| T25 | x      | Catalog Phase 1 — 5 catalog tables + `preference_profiles.version` + empty `CatalogService` shell + `RowFetchContext` extended                                                                                                                                                                                        | V37,V12                                    |
| T26 | x      | Catalog Phase 2 — `canonical_metadata` r/w + features extract + `CatalogPreferenceProvider` cold-fill + `host.catalog.metadata_refresh` job + PE deadline                                                                                                                                                             | V37,V38,V44,V45                            |
| T27 | x      | Catalog Phase 3 — `discover_snapshots` + `host.catalog.discover_snapshot` job + hydrate `newReleases` (trendingNow/upcomingForYou deferred — semantic mismatch)                                                                                                                                                       | V37,V38,V42                                |
| T28 | x      | Catalog Phase 4 — `recommendation_lists` + `host.catalog.recommendation_build` job + `recommendedForYou` hydration + cursor v2 `{p,pv}` + ext rebuild handler                                                                                                                                                         | V37,V38,V43,V15                            |
| T29 | x      | Catalog Phase 5 — `user_history_mirror` + `user_ratings_mirror` + per-user mutex + `host.catalog.user_mirror_sync` job + PE mirror reads                                                                                                                                                                              | V37,V39,V40                                |
| T30 | x      | Catalog Phase 6 — `host.catalog.prune` job + `recordAccess` throttle + `JobService.{isRunning,anyRunning}` re-exports                                                                                                                                                                                                 | V37                                        |
| T31 | x      | Catalog Phase 7 — audit redundant `mv:` capability-level cache (kept as live-fallback safety net); preserve live cap TTLs + `NEGATIVE_TTL_MS`                                                                                                                                                                         | T26,T27,T28                                |
| T32 | x      | Catalog Φ8 — merge `artwork@v1.getArtwork` ∈ canon write. Cold-fill ∧ `host.catalog.metadata_refresh` dispatch both via `allSettled`; `toCanonicalRow` ← bundle, top variant/kind. Unit: top wins, absent=null, `unsupported_id_combo`=quiet. Regression: seed `id_map` → 2nd refresh ⇒ `clear_logo_url`+`thumb_url`. | V44,V46,T26                                |
| T33 | .      | FE → inline canon URLs. Row+card+modal ← `CompactMediaItem.{poster,backdrop,clearLogo}`; `useArtwork` fires ⇔ null. ⊥ regress to per-row RPC.                                                                                                                                                                         | V47,T32                                    |

## §B Bugs

| id  | date | cause | fix |
| --- | ---- | ----- | --- |
