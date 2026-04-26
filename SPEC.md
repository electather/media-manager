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

Capabilities versioned: `metadata@v1`, `watchHistory@v1`, `watchlist@v1`, `ratings@v1`, `recommendations@v1`, `calendar@v1`, `mediaRequest@v1`, `idResolve@v1`, `notificationDelivery@v1`.
Auth kinds: `form` | `oauth_redirect` | `oauth_device` | `none`.
Scope: `global` (admin creds, shared pool) | `user` (per-connection creds).
`ctx.fetch` — single network surface; gated by manifest allowlist + admin allowlist intersection.
`ctx.notify(event)` — emit notification to owning user.
`ctx.store` — plugin-scoped KV, namespaced by `(pluginId, userId, key)`.
`ctx.log` — structured logger; tagged with `requestId`.

### I.deploy — deployment

- CF: `worker.ts` entry, Turso DB, Wrangler, multi-env (`app` / `app-nightly` / `app-pr-{n}`).
- Docker: compiled Bun binary + static client, SQLite volume `/data`, `ghcr.io` images (`nightly` / `latest` / `v*`).
- Migrations run pre-deploy (CF) or at startup (Docker).

### I.notifications — notification events (v1)

`media.available`, `sync.completed`, `sync.failed`, `auth.expired`, `job.failed`, `system.error`.
Channels: `inbox` (in-app), `ntfy`, `telegram`, `discord`.
Categories: `media` | `sync` | `auth` | `system`.

### I.home — home feed procedures

- `home.getLayout` → `HomeLayoutResponse` (hero + rows with first-page items inlined).
- `home.getRowContent` → `RowContentResponse` (paginated scroll).
  Seven row kinds: `continueWatching`, `recommendedForYou`, `trendingNow`, `newReleases`, `becauseYouWatched`, `upcomingForYou`, `yourWatchlist`.

### I.theme — design system

Source: Figma `icLS0oZe6eQL0hRj8Go8Zm` node `31:21`.

### I.layout — frontend layouts

- `AppShell`: layout wrapping the 5 bottom-nav routes — Home (`/`), Activity (`/activity`), Requests (`/requests`), Taste (`/taste`), Profile (`/profile`).
  - Top bar: logo + right-side profile dropdown (Settings, Logout).
  - Bottom nav (all viewports): same 5 items, fixed to bottom of viewport.
- `SettingsLayout`: standalone layout for `/settings/*`. No bottom nav, no AppShell sidebar.
- All other authenticated routes (`/admin/*`, `/setup`, etc.) keep current `AppSidebar` shell — out of scope for this iteration.
- Profile dropdown sole AppShell surface for Settings link + Logout action.

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
- V13. Every published package (non-`shared`) needs a `.changeset/<slug>.md` per PR or CI fails. Internal-only changes use empty frontmatter.
- V14. `vp check` + `vp test` pass before every commit.
- V15. `notifications.emit()` sole entry point for notification dispatch. All call sites (job runner hooks, `ctx.notify()`, server modules) go through it. Delivery durable: every dispatch persisted + retried on transient fail.
- V16. User-facing connections list excludes pure-global plugins (those with no `userScopedCapabilities`). Pure-global plugin surface is admin-only.
- V17. Dark default. `<html>` ship `class="dark"`. Light palette deferred until light theme task lands.
- V18. AppShell wraps Home/Activity/Requests/Taste/Profile only. `/settings/*` uses `SettingsLayout`. Other authenticated routes keep existing `AppSidebar` shell.
- V19. Settings link + Logout action live solely in profile dropdown. AppShell sidebar + bottom nav never list them.
- V20. AppShell uses bottom nav at all viewports. No sidebar in AppShell.

## §T Tasks

| id  | status | desc                                                                     | cites                 |
| --- | ------ | ------------------------------------------------------------------------ | --------------------- |
| T1  | ✓      | Plugin architecture — manifest, capabilities, scope, dispatch            | I.plugin              |
| T2  | ✓      | Plugin monorepo layout — `apps/`, `packages/plugins/*`, plugin-sdk       | I.plugin,C8           |
| T3  | ✓      | MediaService + TMDB reference plugin (`metadata@v1`)                     | I.api,V1              |
| T4  | ✓      | MCP server — 6 tools, OAuth 2.1, dispatcher, registry                    | I.mcp,V1              |
| T5  | ✓      | Error management — capture, codes, correlation, admin viewer             | V5,V6                 |
| T6  | ✓      | Job service — 4 kinds, scheduler, run-logger, admin UI                   | I.api                 |
| T7  | ✓      | Preference engine — scoring, incremental update, rebuild job             | V8,C1                 |
| T8  | ✓      | Connections backend + manifest-driven frontend (`/settings/connections`) | I.api,I.plugin        |
| T9  | ✓      | Plugin advanced admin — host allowlist + custom headers                  | V2,V3,V4,I.api        |
| T10 | ✓      | Notifications — emit, delivery job, inbox + ntfy/telegram/discord        | I.notifications,V15   |
| T11 | ✓      | User settings (5 tabs: profile/security/connections/apps/danger)         | I.api                 |
| T12 | ✓      | Deployment — CF Workers `worker.ts`, Docker, CI workflows                | I.deploy,C6           |
| T13 | x      | Home feed server — `HomeFeedService`, 7 row fetchers, 2 procedures       | I.home,V9,V10,V11,V12 |
| T14 | .      | Home feed frontend — Netflix-style rows, hero, card, detail modal        | I.home,T13            |
| T15 | x      | `home` subpath export in `@ent-mcp/shared`                               | V12,T13               |
| T16 | ?      | User profile page (`/profile` Hono rpc procedures backend)               | I.api                 |
| T17 | x      | AppShell layout — top bar + profile dropdown (Settings/Logout)           | I.layout,V18,V19      |
| T18 | x      | Bottom nav — 5 items, fixed bottom-0, visible at all viewports           | I.layout,V20          |
| T19 | x      | Split `SettingsLayout` standalone from AppShell                          | I.layout,V18          |
| T20 | x      | Stub Home/Activity/Requests/Taste/Profile pages w/ name-only dummy       | I.layout              |

## §B Bugs

| id  | date | cause | fix |
| --- | ---- | ----- | --- |
