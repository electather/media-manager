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
- C11. ∀ utility code (array, object, string, fn, predicate) → `es-toolkit` submodule. ⊥ custom re-impl of `compact`/`merge`/`cloneDeep`/`sortBy`/`orderBy`/`debounce`/`throttle`/`uniq`/`invariant`. Import from `es-toolkit/array`, `es-toolkit/object`, `es-toolkit/string`, `es-toolkit/function`, `es-toolkit/predicate`, `es-toolkit/util`. Patterns: `.agents/skills/es-toolkit/references/patterns.md`.
- C12. Client app feature-first. Three top-level domains under `apps/client/src/`: `app/` (shell), `features/<x>/` (modules), `shared/` (primitives). ⊥ sibling-feature imports. Public surface = `features/<x>/index.ts` barrel only. Cross-feature reach = fallow boundary violation. Routes (`apps/client/src/routes/`) thin — file-based per TanStack Router, ⊥ business logic. Design: `docs/2026-04-29-frontend-structure-design.md`.
- C13. **Mechanical migration only** for T34–T38 (excluding T38 net-new home build). Allowed per-file change set: (1) `git mv` to new path, (2) update import paths in moved file + ∀ consumers, (3) update `index.ts` barrel exports. **Forbidden:** rewriting component bodies, renaming symbols, refactoring logic, splitting/merging files, changing prop signatures, restyling, modernizing patterns, "while we're here" cleanup. Diff per moved file = path delta + import path delta. Behavior parity = pre-existing tests pass unmodified (test imports get path-updated, test bodies stay). ⊥ token spend on rewrites — restructure ≠ rewrite. Drift to rewriting = stop, revert, redo as separate PR after migration lands.
- C14. Paraglide i18n client-only v1. ⊥ server use, ⊥ `@ent-mcp/shared` import (preserve V12). Server emits English event names + raw params; client maps event kind → translated string.
- C15. Generated `apps/client/src/paraglide/` = build artifact. ⊥ commit, ⊥ hand-edit. `.gitignore` entry mandatory.
- C16. Client reactive store v1 = `queryCollectionOptions` (over Hono RPC) only. ⊥ custom collections, ⊥ ElectricSQL, ⊥ `dexieCollectionOptions` v1. Realtime ⊥ v1; polling via `refetchInterval` carries push-style updates until SSE/WS lands. Design: `docs/2026-05-01-client-tanstack-db-design.md`.
- C17. Collection granularity v1 = endpoint-keyed default. **Entity carve-out enumerated: `{ media }`** per I.media-data + `2026-05-01-client-media-data-design.md` (T47-T48). Reference collections (`homeRowItems`) hold id refs only; UI joins via entity collection per V74. New entity collection ≡ new C-line + V-line in this spec; ⊥ implicit extension of the carve-out.
- C18. Persistence layer = `QueryClient` IDB persister (`@tanstack/query-async-storage-persister` + `idb-keyval`). Per-collection IDB (Dexie) ⊥ v1. Filter = opt-out via `meta.persist=false`; default = persist. `maxAge=30d`, `gcTime≥maxAge`, `buster=${VITE_APP_VERSION}-${VITE_SHARED_VERSION}`.
- C19. Service worker out of scope of C16-C18. Persister key shape stable + ⊥ Network-only assumptions so SW slot-in later non-breaking.
- C20. Entity-collection rows track hydration via `_detailFetchedAt: number | null` field. `null` = compact (list-fed); timestamp = full (detail-fed). ⊥ field-presence checks for full-vs-compact. TTL = 1h; refetch on detail open if `null` or `Date.now() - _detailFetchedAt > TTL`.

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

### I.i18n — paraglide-js client i18n

- Locales: `en` (base), `fa` (RTL validation).
- Source: `apps/client/messages/{en,fa}.json`.
- Project: `apps/client/project.inlang/settings.json`.
- Generated: `apps/client/src/paraglide/` (runtime + message accessors).
- Compile: `paraglideVitePlugin({ project, outdir })` in `apps/client/vite.config.ts`. ⊥ CLI compile.
- Strategy chain: `["localStorage", "preferredLanguage", "baseLocale"]`. ⊥ `cookie`, ⊥ `url` v1.
- Runtime: `m.<key>(...)` for messages; `getLocale`/`setLocale` for switch. `setLocale` reloads page.
- RTL: `<html dir>` attr toggled per locale (`fa` → `rtl`, `en` → `ltr`). RTL set = `RTL_LOCALES.includes(locale)`.

### I.media-details — media detail peek modal

- Feature: `apps/client/src/features/media-details/`.
- Mount: `_authenticated` layout (V34) — `?peek=<kind>:<id>` search param drives open/close.
- Source: `peekSchema` in `features/media-details/lib/peek-schema.ts`; re-exported by feature barrel; `_authenticated/route.tsx` `validateSearch` reads from there.
- Composition: `MediaDetailModal` shell + sub-components (one per file): `score-block`, `feedback-bar`, `note-editor`, `trailer-overlay`, `status-tag`, `episode-row`, `season-block`, `seasons-list`, `tv-air-info`, `modal-skeleton`, `modal-action-row`, `modal-seasons-list`.
- Responsive: desktop = `@base-ui/react/dialog` full-overlay popup w/ scroll-driven topbar dock; mobile (≤ `md`) = `vaul` bottom drawer.
- State: client-only Zustand-free store via `@tanstack/react-query` cache + URL params. Notes/watched/watchlist/votes seeded from mock data, mutations write to React Query cache (replaced w/ RPC mutations later).
- Data: stub `mock-data.ts` (HERO/UPCOMING/ROWS, `generateSeasons`); replaced by `discover.details` / `home.*` later (T43.next).
- Requests integration: pulls from `features/requests/` barrel — `WatchActions`, `RequestActions`, `RequestStatusInline`, `RequestableSeasonsList`, `SERVICES`, `effectiveItemRequestStatus`, `describeDestination`. All stubbed v1; real impl future task.
- i18n: messages live in `apps/client/messages/media-details/{en,fa}.json` (per-feature subdir per V61).

### I.client-data — client reactive store

- Stack: `@tanstack/react-db` (collections + `useLiveQuery`), `@tanstack/query-db-collection` (`queryCollectionOptions`), `@tanstack/react-query-persist-client` (`PersistQueryClientProvider`), `@tanstack/query-async-storage-persister` + `idb-keyval` (IDB persist).
- Layout: `apps/client/src/shared/lib/db/{client,persister,provider,test-utils,index}.ts` (infra). Per-feature collections + hooks: `apps/client/src/features/<x>/data/{*.collection.ts,*.hooks.ts,index.ts}`.
- Provider: `<PersistQueryClientProvider client persistOptions={{persister,maxAge,buster,dehydrateOptions}}>` wraps app in `main.tsx`. ⊥ inline `new QueryClient()` ∈ `main.tsx` or feature code.
- Mutation policy:
  - Optimistic = `collection.update/insert/delete`. Toggles + idempotent edits only (e.g. `enabled`, `scheduleOverride`).
  - Non-optimistic = `useMutation` + `queryClient.invalidateQueries`. Side-effect heavy or server-truth ops (run trigger, cancel, create-with-server-id).
- Persistence policy: admin/sensitive (jobs, plugins admin, errors viewer, auth/session) → `meta.persist=false`. User reads (connections, watchlist, home, notifications, settings/prefs) → persist (SWR offline lists).
- Schema: Zod attached to collection only when collection accepts user-authored optimistic writes (validates input). ⊥ schema parse on server-sync writes (server already validated).
- Pilot: `features/jobs` (admin jobs page). Other features migrate post-pilot via future tasks.
- Design: `docs/2026-05-01-client-tanstack-db-design.md`.

### I.media-data — client media entity store + RPC

- Feature: `apps/client/src/features/media/data/`. Successor to T45 read-path; mutations (notes/votes/requests live) deferred to T46.
- **Collections (3):**
  - `media` — entity. Keyed by `id` (`movie:550` | `tv:1396`). Row = `MediaDetail & { _detailFetchedAt: number | null }` (C20). Compact + full rows coexist; timestamp distinguishes. `meta.persist=true`. ⊥ `refetchInterval` — TTL drives staleness.
  - `homeLayout` — singleton (`id: "current"`). Row = `{ generatedAt, hero: { mediaId, source, reason, resumeUrl } | null, rows: [{ rowId, title, subtitle?, cursor }] }`. Persist; `staleTime` 5m.
  - `homeRowItems` — refs. Row = `{ id: "<rowId>:<page>:<position>", rowId, mediaId, position, page }`. Persist; `staleTime` 1m.
- **Server endpoints:** `POST /api/media/get { id }` → `MediaDetail`. `POST /api/media/getMany { ids }` → `{ items: MediaDetail[] }` (missing ids omitted, ⊥ throw). Both `requireSession`.
- **Mapper:** `apps/server/src/media/mappers.ts` — `mapToMediaDetail(raw, id)` deterministic. `MediaService.getDetailsTyped` + `getDetailsBatchTyped` wrap raw plugin payloads.
- **Wire shape:** `MediaDetail` Zod schema in `@ent-mcp/shared/media` = single source. `CompactMediaItem = Pick<MediaDetail, COMPACT_FIELDS>` derived. `home.*` emits compact subset; `media.*` emits full.
- **Hooks** (sole consumer surface per V73): `useHomeLayout()`, `useHomeRow(rowId)`, `useMediaRow(id)`, `useMediaDetail(id)`. `useHomeRow` joins `homeRowItems` × `media` (V74 entity-↔-ref). `useMediaDetail` returns `{ item, isHydrating, isFullyLoaded }`.
- **Sync helpers** (`features/media/data/sync.ts`): `splitLayoutResponse`, `splitRowContent`, `writeCompactToMedia` (⊥ overwrite full), `writeFullToMedia`, `loadRowPage`, `ensureDetail` (dedup via `queryClient.fetchQuery({ queryKey: ["media", "detail", id] })`).
- **Mount points:** home page (`routes/_authenticated/_app/index.tsx`), peek modal (V75 — mounted at `_authenticated`), full-page detail (`routes/_authenticated/_app/media/$id.tsx`).
- **Mocks deleted by T48:** `features/media/lib/{mock-data,find-item}.ts` + in-route mock builders.
- **Persistence:** shared `buster` (V69); schema break wipes all 3 IDB stores atomic.
- **Out of scope:** mutations (T46), realtime/SSE, search/discover wiring, image proxy, pull-to-refresh.
- Design: `docs/2026-05-01-client-media-data-design.md`.

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
- V31. Single `Card` component. Treatment dispatch from item shape: progress→continue-watching, episode→upcoming, neither→default. Aspect from `ROW_DISPLAY[rowId].aspectRatio`. Size from `@container` query (hero/row/sidebar). Thumb-mode breakpoint = container width `< 160px` (ResizeObserver). ⊥ duplicate card variants.
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
- V44. Single canonical artwork URL per kind on `canonical_metadata` (`poster_url`, `backdrop_url`, `clear_logo_url`). Row read = serve cols inline; ⊥ plugin dispatch on row path. Slot NULL → omitted from wire; client may call `/artwork.get` to fill.
- V45. `PreferenceEngine.getItemFeatures` reads from `canonical_metadata.features`. ⊥ `skipCache: true` plugin path. Miss → cold-fill writes back to catalog.
- V46. TMDB `metadata@v1` mapper lifts `backdrop_path` → `backdropUrl` ∀ `mapMovie`/`mapShow` paths. Cold-fill row carries poster + backdrop + overview from one dispatch. ⊥ second plugin call for backdrop.
- V47. `/artwork.get` always dispatches `artwork@v1` via `mv:` cache layer. ⊥ canonical lookup. Plugin response → `catalog.patchArtwork(key, top1(bundle))` fire-forget. Next row read serves slot inline → ⊥ further `/artwork.get` for that key.
- V48. `catalog.patchArtwork` UPDATE w/ `COALESCE(col, ?)` ∀ artwork cols. ⊥ overwrite filled URL. Row absent → 0 rows affected, ⊥ throw. Concurrent patches → first-writer-wins on null cols, ⊥ clobber on filled.
- V49. MCP tool `outputSchema` item shapes → Zod schema via `zodToItemSchema`. ⊥ hand-written JSON Schema literals for typed item shapes. Zod schema = single source: `z.infer` → TS type, `zodToItemSchema` → JSON Schema. `zodToItemSchema` ∈ `@ent-mcp/shared/common`; strips `$schema` URI meta field emitted by `z.toJSONSchema`.
- V50. ∀ server utility code → `es-toolkit` submodule import (C11). ⊥ `compact`, `merge`, `cloneDeep`, `orderBy`, `sortBy`, `uniq`, `debounce`, `throttle`, `invariant` reimplemented inline. `.filter(Boolean)` → `compact`. `structuredClone` on plain objects → `cloneDeep`. `.sort((a,b)=>...)` for ordering → `orderBy`/`sortBy`. Violation detectable via fallow unused-dep signal inversed: if `es-toolkit` unused → new utility code added without consulting it.
- V51. `apps/client/src/` layout = three top-level domains: `app/` (shell + root chrome), `features/<x>/` (self-contained modules w/ `components/`, `hooks/`, `lib/`, `__tests__/` + `index.ts` barrel), `shared/` (`ui/`, `components/`, `hooks/`, `lib/`). Routes file-based, thin, ⊥ business logic. New feature = new dir under `features/`.
- V52. ∀ outside-feature import resolves through `@/features/<x>` path alias (= `features/<x>/index.ts` barrel). ⊥ deep-import `@/features/<x>/components/foo` from outside feature. Inside-feature imports = relative paths.
- V53. `client-app` zone ⊥ allow `client-feat-*`. Shell stays feature-agnostic. Shell importing feature = always-eager bundle.
- V54. `client-feat-<x>` ⊥ allow `client-feat-<y>`. Sibling-feature reach = boundary violation. Cross-feature need → lift to `shared/`.
- V55. `client-shared-*` ⊥ allow `client-feat-*`. Shared = primitives only, ⊥ feature spillover. Two features need same util → util belongs `shared/lib/`. Two features need same component → first move lifts to `shared/components/`, ⊥ inline duplicate.
- V56. `features/<x>/lib/mutations.ts` (and ∀ feature module touching backend) imports RPC client via `@/shared/lib/api`. ⊥ direct `server-api` zone reach from features. RPC client = sole bridge.
- V57. ⊥ barrel `index.ts` in `features/<x>/{components,hooks,lib}/` subdirs. Subdir barrels break tree-shake + invite circular imports. Only feature-root `index.ts` re-exports public surface.
- V58. Tests colocate per subject inside feature: `features/<x>/__tests__/`. ⊥ orphan tests at `apps/client/src/__tests__/`. Shared lib tests flatten in `shared/lib/__tests__/` (pre-existing pattern).
- V59. Path alias scheme `@/{app,features,shared,routes}` resolved identically by TS, Vite, Vitest. ⊥ "works in IDE, fails in build". Single config update touches all three.
- V60. `.fallowrc.json` = sole enforcement substrate for V51–V58. Client zones at repo root config:
  - **Required zones:** `client-routes`, `client-app`, `client-feat-<x>` (one per `apps/client/src/features/<x>/`), `client-shared-{ui,components,hooks,lib}`, `client-root`.
  - **Required allow rules** (concise form; full table in `docs/2026-04-29-frontend-structure-design.md`): `client-app` allows `client-shared-*` + `shared-pkg` only. `client-feat-<x>` allows `client-shared-*` + `shared-pkg` only — sibling `client-feat-<y>` ⊥ allowed. `client-shared-components` allows `client-shared-{ui,hooks,lib}` + `shared-pkg`. `client-shared-hooks` allows `client-shared-lib` + `shared-pkg`. `client-shared-ui` allows `client-shared-lib` + `shared-pkg` (shadcn `cn` from `lib/utils` is universal coupling — see §B1). `client-shared-lib` allows `shared-pkg` + `server-api` + `server-root`. `client-routes` allows `client-app` + `client-feat-*` + `client-shared-*` + `shared-pkg`.
  - **Drift = spec violation.** Adding a feature without adding `client-feat-<x>` zone, or weakening allow rules to permit sibling-feature import, fails `vp check`.
  - **Mechanical rule:** every new `apps/client/src/features/<x>/` dir = exactly one matching `client-feat-<x>` zone in same PR. ⊥ orphan dir, ⊥ orphan zone.
  - Legacy zones `client-components`, `client-hooks`, `client-lib` removed by T34. Their absence = post-migration baseline.
- V61. Translatable chrome copy imported via `@/paraglide/messages` only. ⊥ inline literals for translated strings. Generated `paraglide/` ⊥ hand-edited; vite plugin recompiles on `messages/*.json` + `project.inlang/settings.json` change.
- V62. `@ent-mcp/shared` ⊥ paraglide imports. v1 i18n boundary = client only. Server payload shape ⊥ change for translation; client owns event-kind→message map.
- V63. Locale strategy chain frozen `["localStorage", "preferredLanguage", "baseLocale"]` v1. ⊥ add `url`/`cookie` w/o spec amend — URL strategy interacts w/ V32-V34 peek-modal flow + needs redirect-loop audit.
- V64. `<html dir>` attr managed by single root hook reading `getLocale()`. RTL set ⇔ `RTL_LOCALES = ["fa"] as const` includes locale. ⊥ component-local `dir` attrs.
- V65. `QueryClient` singleton ∈ `apps/client/src/shared/lib/db/client.ts`. ⊥ second instance, ⊥ inline `new QueryClient()` ∈ `main.tsx` or feature code.
- V66. ∀ collection wrapping server data → `queryCollectionOptions` w/ `queryClient` from V65. ⊥ ad-hoc `createCollection` ∈ feature path that bypasses the singleton.
- V67. Optimistic mutation = `collection.update/insert/delete` (auto-rollback on handler reject). Non-optimistic = `useMutation` + `queryClient.invalidateQueries`. ⊥ mix paths for same op.
- V68. ∀ admin / sensitive query → `meta: { persist: false }` on `queryCollectionOptions` (or underlying `useQuery`). ⊥ admin row leaked to IDB. Domains: `admin.*`, `auth.*`, session, security tokens.
- V69. Buster string = `${import.meta.env.VITE_APP_VERSION}-${import.meta.env.VITE_SHARED_VERSION}` mounted on `PersistQueryClientProvider`. Buster bump ⇒ IDB cache wiped on next mount. Bump on shape break.
- V70. Schema (Zod) attached to collection only when collection accepts user-authored optimistic writes (input validation). ⊥ schema parse on server-sync writes — server already validated; double-parse cost no value. **Carve-out:** entity-collection rows (V78+) may carry a Zod schema for shape-stability checks ∈ tests; runtime parse on server-sync writes still ⊥.
- V71. Collection `id` field = stable string `${domain}.${endpoint}[.${param}]`. Drives devtools labels + persistence keys. ⊥ random / unstable `id`.
- V72. ⊥ TanStack DB symbol imported from `@ent-mcp/shared`. Client dep only (preserves V12 + C7).
- V73. Hooks (`features/<x>/data/*.hooks.ts`) = sole consumer surface for collections. Components ⊥ import collection direct from sibling component file.
- V74. Live-query joins across collections gated to entity-↔-reference pairs only. **Definitions:** entity = collection where row owns full domain shape (carve-out enumerated ∈ C17 = `{ media }`); reference = collection holding only id refs + position metadata (e.g. `homeRowItems`); endpoint-keyed = collection wrapping single Hono RPC procedure (e.g. `jobsList`). Sole permitted join v1 = `homeRowItems` × `media`. ⊥ joins between two reference collections, ⊥ joins between two endpoint-keyed collections, ⊥ joins between two entity collections. Additional entity-collection joins require spec amend.
- V75. `MediaDetailModal` mounted exactly once at `_authenticated` route layout (V34 reaffirmed). ⊥ per-route mount, ⊥ duplicate instance. Peek state source = `?peek=<kind>:<id>` search param parsed by `peekSchema`. ⊥ component-local `useState` for `peekId`. Modifier-clicks on cards fall through to real `/media/{id}` URL (V33).
- V76. Per-feature i18n message files = `apps/client/messages/<feature>/{locale}.json`. New feature adding strings = new subdir + `pathPattern` entry in `project.inlang/settings.json` + new keys imported via `@/paraglide/messages`. ⊥ flat `messages/{locale}.json`. ⊥ inline literals for translatable chrome (V61 reaffirmed).
- V77. `features/requests/` is sole owner of request-state UI components (`WatchActions`, `RequestActions`, `RequestStatusInline`, `RequestableSeasonsList`) + helpers (`effectiveItemRequestStatus`, `describeDestination`, `SERVICES`). `features/media-details/` consumes via `@/features/requests` barrel only (V52). ⊥ duplicate request-status logic across features. **V54 carve-out:** `client-feat-media-details` → `client-feat-requests` is the sole permitted sibling-feature edge; encoded in `.fallowrc.json` allow list, mirrored in design doc allow table. Adding any other media-details ↔ feature edge requires SPEC amend.
- V78. ∀ row in entity-collection (`media`) carries `_detailFetchedAt: number | null` (C20). Zod schema on collection requires field present at write site; ⊥ `undefined` at runtime.
- V79. `writeCompactToMedia` ⊥ overwrites detail-only fields of an existing full row. Strip undefined compact fields via `omitBy(isNil)` (`es-toolkit/object` + `/predicate`) before merge — undefined ⊥ nuke existing values. Detail-only fields preserved across compact-write.
- V80. `writeFullToMedia` always sets `_detailFetchedAt = Date.now()`. ⊥ partial full-write. Concurrent compact writes mid-fetch overwritten on full write (accepted; compact subset re-refreshes on next list mount).
- V81. `ensureDetail(id)` idempotent. Concurrent callers dedupe via `queryClient.fetchQuery` keyed `["media", "detail", id]`. ⊥ two `media.get` RPCs in flight for same id.
- V82. Reference collections (`homeRowItems`) hold `mediaId` only. ⊥ duplicate media row data across collections. UI joins via TanStack DB live-query `innerJoin` per V74.
- V83. ⊥ `_detailFetchedAt` import in `apps/client/src/features/<x>/components/**`. Render-path consumes derived `isHydrating` / `isFullyLoaded` from hooks only. Grep-checkable.
- V84. `MediaDetail` Zod schema (`@ent-mcp/shared/media`) = single wire-shape source. `CompactMediaItem = Pick<MediaDetail, COMPACT_FIELDS>` derived. `home.*` procedures emit compact subset; client treats received compact as `Partial<MediaDetail>` — ⊥ explicit field expansion to undefined.
- V85. Server mapper `mapToMediaDetail(raw, id)` deterministic. ⊥ `Math.random`. ⊥ `Date.now()` / wall-clock. CI grep guard ∈ test suite.
- V86. Sync write order: `mediaCollection` writes first, reference-collection writes second. Render-time stale-ref handling via `compact()` from `es-toolkit/array` (V50; ⊥ raw `.filter(Boolean)`).
- V87. Detail TTL = 1h (C20). TTL gate site = `ensureDetail` only (via `queryClient.fetchQuery` `staleTime`). ⊥ time math on `_detailFetchedAt` ∈ component or other modules. Buster bump (V69) or future pull-to-refresh sole override paths.
- V88. Cold peek (id ⊥ `mediaCollection`): `useMediaDetail` returns `{ item: null, isHydrating: true, isFullyLoaded: false }`. Modal renders full skeleton until `media.get` resolves. ⊥ render with empty placeholder fields.
- V89. `media` + `homeRowItems` collections use `localOnlyCollectionOptions` (no queryFn — write-driven). `homeLayout` uses `queryCollectionOptions` (network-fed singleton). Sole layout writer = `homeLayoutCollection.queryFn`; sync helpers ⊥ `homeLayoutCollection.utils.writeUpsert`. Cursor advancement via `queryClient.setQueryData(["home","layout"], ...)`.
- V90. `MEDIA_ID_REGEX` exported from `@ent-mcp/shared/media` is sole regex source. `peekSchema`, `mediaGetInputSchema`, `mediaGetManyInputSchema` import the constant. ⊥ inline regex copies ∈ codebase.

NOTE: V30 + V31 reference `lib/home-display.ts` + `ROW_DISPLAY` map, both retired by `2026-04-23-home-feed-frontend-design.md` (T14 cancelled, restructure-aware T38 supersedes). Resolution tracked in T39. ⊥ silently rewriting V30/V31 — invoke `/spec amend §V` to retire.

| id  | status | desc                                                                                                                                                                                                                            | cites                                      |
| --- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| T1  | ✓      | Plugin architecture — manifest, capabilities, scope, dispatch                                                                                                                                                                   | I.plugin                                   |
| T2  | ✓      | Plugin monorepo layout — `apps/`, `packages/plugins/*`, plugin-sdk                                                                                                                                                              | I.plugin,C8                                |
| T3  | ✓      | MediaService + TMDB reference plugin (`metadata@v1`)                                                                                                                                                                            | I.api,V1                                   |
| T4  | ✓      | MCP server — 6 tools, OAuth 2.1, dispatcher, registry                                                                                                                                                                           | I.mcp,V1                                   |
| T5  | ✓      | Error management — capture, codes, correlation, admin viewer                                                                                                                                                                    | V5,V6                                      |
| T6  | ✓      | Job service — 4 kinds, scheduler, run-logger, admin UI                                                                                                                                                                          | I.api                                      |
| T7  | ✓      | Preference engine — scoring, incremental update, rebuild job                                                                                                                                                                    | V8,C1                                      |
| T8  | ✓      | Connections backend + manifest-driven frontend (`/settings/connections`)                                                                                                                                                        | I.api,I.plugin                             |
| T9  | ✓      | Plugin advanced admin — host allowlist + custom headers                                                                                                                                                                         | V2,V3,V4,I.api                             |
| T10 | ✓      | Notifications — emit, delivery job, inbox + ntfy/telegram/discord                                                                                                                                                               | I.notifications,V15                        |
| T11 | ✓      | User settings (5 tabs: profile/security/connections/apps/danger)                                                                                                                                                                | I.api                                      |
| T12 | ✓      | Deployment — CF Workers `worker.ts`, Docker, CI workflows                                                                                                                                                                       | I.deploy,C6                                |
| T13 | ✓      | Home feed server — `HomeFeedService`, 7 row fetchers, 2 procedures                                                                                                                                                              | I.home,V9,V10,V11,V12                      |
| T14 | x      | Home feed frontend — route, single-source `ROW_DISPLAY`, single `Card`, layout-level peek modal                                                                                                                                 | I.home,T13,T16,V30,V31,V32,V33,V34,V35,V36 |
| T15 | ✓      | `home` subpath export in `@ent-mcp/shared`                                                                                                                                                                                      | V12,T13                                    |
| T16 | .      | Decide `resumeUrl` capability: `watchHistory@v1` ext vs new `playback@v1`                                                                                                                                                       | I.home,T13                                 |
| T17 | .      | `@ent-mcp/plugin-sdk/testing` — `makeTestContext`, fetch helpers, fixtures from contract tests                                                                                                                                  | C8,V23                                     |
| T18 | .      | Per-plugin extraction — TVDB, TMDB, Seerr, Trakt, Plex, Jellyfin → `packages/plugins/<id>/`; delete builtin/ husk                                                                                                               | C8,V22,V23,V24                             |
| T19 | .      | Boundary lint + SDK-compat CI checks wired into `vp check`                                                                                                                                                                      | V24,V25                                    |
| T20 | .      | Release workflow — GHCR Docker push (server), `dist/*` assets on plugin + SDK GitHub Releases                                                                                                                                   | I.deploy                                   |
| T21 | x      | Per-`Row` error boundary — bad item / unhandled card render error hides single row, ⊥ crash whole feed                                                                                                                          | T14                                        |
| T22 | x      | `CenteredState` primitive shared by `home-feed-empty` + `home-feed-error` (title + body + action button)                                                                                                                        | T14                                        |
| T23 | x      | Carousel keyboard pattern — arrows out of Tab order; cards in Tab; `ArrowLeft`/`Right` scroll within row                                                                                                                        | T14                                        |
| T24 | x      | Progress-bar color token `--color-progress-watched`; ⊥ reuse `--color-text-danger` (text role on non-text surface)                                                                                                              | T14                                        |
| T25 | x      | Catalog Phase 1 — 5 catalog tables + `preference_profiles.version` + empty `CatalogService` shell + `RowFetchContext` extended                                                                                                  | V37,V12                                    |
| T26 | x      | Catalog Phase 2 — `canonical_metadata` r/w + features extract + `CatalogPreferenceProvider` cold-fill + `host.catalog.metadata_refresh` job + PE deadline                                                                       | V37,V38,V44,V45                            |
| T27 | x      | Catalog Phase 3 — `discover_snapshots` + `host.catalog.discover_snapshot` job + hydrate `newReleases` (trendingNow/upcomingForYou deferred — semantic mismatch)                                                                 | V37,V38,V42                                |
| T28 | x      | Catalog Phase 4 — `recommendation_lists` + `host.catalog.recommendation_build` job + `recommendedForYou` hydration + cursor v2 `{p,pv}` + ext rebuild handler                                                                   | V37,V38,V43,V15                            |
| T29 | x      | Catalog Phase 5 — `user_history_mirror` + `user_ratings_mirror` + per-user mutex + `host.catalog.user_mirror_sync` job + PE mirror reads                                                                                        | V37,V39,V40                                |
| T30 | x      | Catalog Phase 6 — `host.catalog.prune` job + `recordAccess` throttle + `JobService.{isRunning,anyRunning}` re-exports                                                                                                           | V37                                        |
| T31 | x      | Catalog Phase 7 — audit redundant `mv:` capability-level cache (kept as live-fallback safety net); preserve live cap TTLs + `NEGATIVE_TTL_MS`                                                                                   | T26,T27,T28                                |
| T32 | x      | Artwork inline + write-back — TMDB mapper lifts `backdrop_path`; drop `thumb_url` col; `catalog.patchArtwork` COALESCE update; `artwork.service` dispatch→patch; client `useArtworkIfMissing`; swap card/hero/sidebar consumers | V44,V46,V47,V48                            |
| T33 | x      | Path aliases — add `@/{app,features,shared,routes}` to `tsconfig.json` + `vite.config.ts` + Vitest resolve. ⊥ move files yet. Lands resolver groundwork.                                                                       | C12,V51,V52,V59                            |
| T34 | x      | Move shared — `components/{ui,error-boundary,logo,not-found,user-avatar,log-viewer,json-viewer,pickers,cron-schedule}` → `shared/`. `hooks/use-now.ts` → `shared/hooks/`. `lib/*` (except `home-display.ts`) → `shared/lib/`. Add `client-shared-*` fallow zones, drop legacy `client-{components,hooks,lib}`. **Mechanical: `git mv` + import path update only, ⊥ rewrites (C13).** | C12,C13,V51,V55,V58,V60   |
| T35 | x      | Carve `app/` — `components/app-shell/*` + `components/settings/settings-layout.tsx` → `app/`. Delete empty `components/auth-shell/`. Update `client-app` fallow zone patterns + allow rules. **Mechanical: `git mv` + import path update only, ⊥ rewrites (C13).**                                   | C12,C13,V51,V53,V60                |
| T36 | x      | Lift cross-feature offender — `components/connections/schema-form.tsx` → `shared/components/schema-form.tsx`. Used today by `components/admin/shared-credentials/dialog.tsx` (sibling-feature reach). Re-grep ∀ remaining cross-feature imports before T37. **Mechanical: `git mv` + import path update only, ⊥ rewrites (C13).**  | C13,V54,V55,V60         |
| T37 | x      | Migrate features sequentially — `connections` → `settings` → `admin` → `jobs`. Each PR: `git mv` files, add `client-feat-<x>` zone, write `index.ts` barrel, update consumer import paths, move tests (bodies untouched), regen `routeTree.gen.ts`. One feature per PR. New zone in `.fallowrc.json` per V60 mandatory. **Mechanical: ⊥ rewrites (C13). Component/hook/lib bodies identical pre/post move.**                                                  | C12,C13,V51,V52,V54,V57,V58,V60 |
| T38 | .      | `features/home/` — net-new build per `2026-04-23-home-feed-frontend-design.md`. Includes `components/`, `hooks/`, `lib/collections/{media,row-entries,progress}-collection.ts` + `lib/mutations.ts`. `lib/home-display.ts` → `features/home/lib/` transient (retired in T39). Supersedes T14. | I.home,T14,T34,T35,T37,V51,V52,V56,V57 |
| T39 | .      | Retire `home-display.ts` + V30 + V31 — runs after T38 home-feed Card lands. Deletes `features/home/lib/home-display.ts` + `ROW_DISPLAY` map. Amend §V to retire V30, V31.                                                       | T38                                        |
| T40 | .      | Verification gates — `vp check` + `vp test` + `vp dlx fallow` zero-warning baseline after ∀ T33-T39 step. Fallow run = boundary gate; ⊥ skip. `.fallowrc.json` must encode V60 zone + allow-rule contract; CI rejects PRs that add `features/<x>/` without matching `client-feat-<x>` zone, or weaken allow rules. **Per C13: pre-existing tests pass unmodified after T34-T37 — only test import paths may change, ⊥ test bodies. Diff audit: any non-import line change in moved file = C13 violation, redo PR.**                                                                                  | C13,V51-V60                          |
| T41 | x      | Paraglide infra — `vp add @inlang/paraglide-js`, `apps/client/project.inlang/settings.json` w/ `en`+`fa`, `messages/{en,fa}.json` skeleton, `paraglideVitePlugin` in `vite.config.ts`, `.gitignore` `apps/client/src/paraglide/`, root `<html dir>` hook, locale init wiring strategy `[localStorage, preferredLanguage, baseLocale]`. | C14,C15,V61,V62,V63,V64,I.i18n |
| T42 | x      | Notifications panel chrome translation POC — extract translatable strings from `notification-panel.tsx`, `notification-panel-body.tsx`, `notification-empty-state.tsx`, `notification-item.tsx`, `notification-category-chip.tsx` to `messages/{en,fa}.json`. Scope: "Notifications" header, "Mark all read", "{count} unread" plural, category labels (media/sync/auth/system), "All" chip, empty-state copy, "Admin" badge, dismiss aria, "Notification settings", "View all", bell aria-label w/ unread count plural. ⊥ translate fixture `title`/`body` (deferred). Plural via paraglide ICU. | T41,V61,I.i18n,I.notifications |
| T43 | x      | TanStack DB infra — `vp add` deps (`@tanstack/react-db`, `@tanstack/query-db-collection`, `@tanstack/query-async-storage-persister`, `@tanstack/react-query-persist-client`, `idb-keyval`). Build `shared/lib/db/{client,persister,provider,test-utils,index}.ts`. Swap `main.tsx` `QueryClientProvider` → `AppDataProvider`. Add `vite.config.ts` `define` for `VITE_APP_VERSION` + `VITE_SHARED_VERSION` (read from `apps/client/package.json` + `packages/shared/package.json`). Persister + buster + opt-out filter unit tests in `shared/lib/db/__tests__/`. | I.client-data,C16,C18,C19,V65,V68,V69,V72 |
| T44 | x      | Jobs pilot — `features/jobs/data/{jobs-list.collection.ts,job-detail.collection.ts,jobs.hooks.ts,index.ts}`. Migrate `routes/_authenticated/_settings/admin/jobs.tsx` (list + detail + config modal) + `features/jobs/components/trigger-dialog.tsx` from raw `useQuery`/`useMutation` to hooks. Optimistic = `enabled` toggle + `scheduleOverride`. Non-optimistic = `trigger`, `cancel`. Detail factory `jobDetailCollection(id)` cleanup verified ⊥ leak on drawer close (R3). Hook + rollback tests in `features/jobs/__tests__/`. Changeset `@ent-mcp/client: minor`. | T43,I.client-data,C17,V66,V67,V68,V73 |
| T45 | x      | `features/media-details/` — net-new peek modal feature. Components: `media-detail-modal`, `score-block`, `feedback-bar`, `note-editor`, `trailer-overlay`, `status-tag`, `episode-row`, `season-block`, `seasons-list`, `tv-air-info`, `modal-skeleton`, `modal-action-row`, `modal-seasons-list` (one per file). Lib: `peek-schema.ts` (move from `lib/home-display.ts` re-export), `mock-data.ts`, `find-item.ts`, `use-peek.ts`, `use-detail-store.ts`. Stub `features/requests/` w/ `WatchActions`, `RequestActions`, `RequestStatusInline`, `RequestableSeasonsList`, `SERVICES`, `effectiveItemRequestStatus`, `describeDestination`. Desktop = base-ui Dialog primitives; mobile = vaul Drawer. Mount at `_authenticated` route. Animations imperative-rAF (parallax + dock-logo) ported as-is (refactor later). Add `client-feat-media-details` + `client-feat-requests` fallow zones (V60). i18n strings under `messages/media-details/{en,fa}.json` (V66). | C12,V32,V33,V34,V51,V52,V60,V61,V65,V66,V67,I.media-details |
| T46 | .      | Wire mutations for media-details — notes/votes hit `preferences.feedback`; replace `features/requests/` stubs w/ live request flow; introduce `media.getMany` client caller (visible-row prefetch / offline preload). Read-only data wiring split out to T47/T48. | T43,T47,T48,I.api,I.media-details |
| T47 | .      | Server + shared media data — `MediaDetail` Zod schema in `@ent-mcp/shared/media` (full + compact + season/episode types) + `MEDIA_ID_REGEX` single source; `CompactMediaItem = Pick<MediaDetail, COMPACT_FIELDS>` derived; `media.get` + `media.getMany` Hono procedures (`apps/server/src/api/procedures/media.ts`); deterministic mapper `apps/server/src/media/mappers.ts` w/ TMDB fixtures; `MediaService.getDetailsTyped` / `getDetailsBatchTyped`. Refactor `home/compact.ts:toCompact` to delegate to shared mapper preserving extras-merge; pin row JSON snapshots pre-refactor. Tests: mapper deterministic + grep guard for `Math.random`/`Date.now()` + procedures auth/validation/not-found/batch-missing. | C20,V78,V79,V80,V84,V85,V90,I.media-data,I.api,I.media-details |
| T48 | .      | Client media data wiring — `features/media/data/{media,home-layout,home-row-items}.collection.ts` (`media`+`homeRowItems` use `localOnlyCollectionOptions` per V89; `homeLayout` uses `queryCollectionOptions` as sole network fetcher) + `sync.ts` (uses `omitBy(isNil)` per V79; cursor via `queryClient.setQueryData`) + `media.hooks.ts` (live-join via TanStack DB `innerJoin` per V82); rewrite `routes/_authenticated/_app/index.tsx` (home), `media-detail-modal.tsx` + `media-detail-modal-content.tsx` + `modal-seasons-list.tsx` + `seasons-list.tsx` + `trailer-overlay.tsx` (peek) + `routes/_authenticated/_app/media/$id.tsx` (full-page) to consume hooks; rename `kind` → `mediaType` ∀ media components; replace client-local `MediaDetailItem` w/ shared `MediaDetail`; consolidate `MEDIA_ID_REGEX` (delete local `PEEK_ID_REGEX`); delete `features/media/lib/{mock-data,find-item}.ts` + in-route mock builders; add `client-feat-media` fallow zone (allows `client-feat-requests` + `client-shared-*` + `shared-pkg`); `useDetailStore` mutations stay react-query cache-backed (T46). Persistence: all 3 collections `meta.persist=true`. Tests: sync split + `writeCompactToMedia` non-overwrite + `ensureDetail` TTL + dedup + live-join + cold-peek skeleton + V12/V13 grep guards. Changeset `@ent-mcp/client: minor` (1-2 non-technical sentences per memory #11). Pre-commit `vp check && vp test`. | T43,T45,T47,C17,C20,V73,V74,V75,V78,V79,V80,V81,V82,V83,V84,V85,V86,V87,V88,V89,V90,I.client-data,I.media-data |

## §B Bugs

| id  | date | cause | fix |
| --- | ---- | ----- | --- |
| B1  | 2026-04-29 | V60 allow table omitted `client-shared-ui` → `client-shared-lib` edge; shadcn `cn` from `lib/utils` is universal pattern — 26 ui files import it. T34 boundary check failed. | Amended V60: `client-shared-ui` allows `client-shared-lib` + `shared-pkg`. Design doc allow table mirrored. Fallow gate re-passes at zero. |
