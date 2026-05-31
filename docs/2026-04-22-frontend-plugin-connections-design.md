# Connections & Plugins UI — Revised Frontend Design

**Status:** Finalized
**Date:** 2026-04-22 (finalized 2026-04-23)
**Author:** Omid Astaraki
**Supersedes:** `2026-04-19-frontend-connections-design.md`
**Companion:** `2026-04-19-plugin-architecture-design.md` (backend)
**Tracking issue:** [#36](https://github.com/electather/media-manager/issues/36)

> **Route relocated (2026-04-24).** The user-facing connections page described here now lives at `/settings/connections` under the nested settings layout. The top-level `/connections` URL was removed and returns 404. The component body, queries, mutations, capability badges, and modal dependencies documented below are unchanged — only the route file location and the app sidebar entry changed. See `docs/2026-04-24-user-settings-design.md` for the relocation rationale and the surrounding settings work.

## Summary

The backend plugin architecture has been revised: capabilities now carry an explicit `scope` (`global` | `user`), admin-owned secrets live in a `plugin_shared_credentials` **pool** (multiple entries per plugin, with rotation and cooldown bookkeeping), and a per-plugin `personalKeyFallback` policy defines how the admin pool and a user's own keys interact for user-scoped calls. The bespoke `allowsSharedCredentials` flag is gone; pool-safety is expressed via `poolable`.

The current frontend still assumes the old shape. This document specifies how to refactor the two existing pages and their supporting components to drive entirely off the revised manifest and the revised RPC surface.

This is a **bundled client + server PR**. A reconciliation pass at finalization time found four server gaps that the frontend work depends on (`displayFields` on connection responses, scoped capability arrays on the embedded plugin shape in `GET /api/connections/`, `sharedCredentialsEnabledCount` on `GET /api/plugins/`, and typed error codes for form validation). They ship alongside the frontend refactor in the same PR, per the migration notes at the bottom of this doc. Additionally a new endpoint for **ephemeral** shared-credential testing lands in the same PR so `Test & save` in the admin dialog runs against an unsaved value without writing it first.

Pages affected:

- `packages/client/src/routes/_authenticated/connections.tsx` — user-facing.
- `packages/client/src/routes/_authenticated/admin/plugins.tsx` — admin-facing.
- `packages/client/src/components/connections/connection-modal.tsx` — shared.
- `packages/client/src/components/connections/schema-form.tsx` — shared.
- `packages/client/src/lib/capabilities.ts` — shared.

The visual language from the previous iteration (shadcn/ui, two-block layout on `/connections`, list-of-cards on `/admin/plugins`, bespoke schema form) stays. This is a data-model and interaction refactor, not a redesign.

## Goals

- Every UI decision maps to a manifest field or API response; no plugin-id or service-name branches survive.
- Distinguish **global-scoped capabilities** ("already works for everyone, no action needed") from **user-scoped capabilities** ("requires a connection") in every surface that lists capabilities.
- Expose the admin-owned shared-credential **pool** as a first-class surface: list, add, edit, enable/disable, test, and delete entries, with cooldown state visible.
- Let admins choose a `personalKeyFallback` policy per plugin with copy that explains the behaviour.
- Preserve the three auth ceremonies (form / `oauth_redirect` / `oauth_device`) and the bespoke `SchemaForm`; extend them minimally where the new model requires.
- Remove every reference to the legacy `allowsSharedCredentials` flag and the single-blob shared-credentials dialog.

## Non-goals

- Plugin install UI from a URL. The current admin page states install is out of scope for v1; this refactor keeps it that way. Copy and button affordances are added but wired to a stub.
- Pool telemetry dashboards. Per-entry `last_exhausted_at` / `retry_after` render inline on the entry row; no dedicated chart.
- Per-entry quota editing, weighted rotation, or sticky-per-user UI. Backend ships round-robin; UI exposes no knob for it.
- User-installable plugins. Admin-only throughout.
- i18n for plugin-provided strings.
- Migration of the client from the Hono REST client to RPC procedure calls. Response typing moves to `InferResponseType<typeof api.x.$get>` (inferred off the existing Hono client); call sites keep using the existing REST verbs.

## What changes vs. current code

| Area                                     | Old                                                                                                           | New                                                                                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capability listing on plugin list        | Already landed: `capabilities: Array<{id, version, scope}>`                                                   | No change — stays as-is                                                                                                                                       |
| Capability listing on connection list    | `connection.plugin.capabilities: string[]` (e.g. `"watchHistory@v1"`)                                         | Full `PluginSummary` shape with scoped arrays; server migration folded into this PR                                                                           |
| `GET /api/plugins/` row shape            | Nested `manifest` + flat top-level meta; admin UI reads `plugin.manifest.name` etc.                           | Unchanged (doc initially proposed flattening; reverted after reconciliation)                                                                                  |
| `sharedCredentialsCount` semantics       | Currently means **enabled** entries (server calls `countEnabled`)                                             | Widened to **total** entries; new `sharedCredentialsEnabledCount` takes over the enabled count                                                                |
| Global capabilities                      | Not distinguished                                                                                             | Rendered separately with muted "available out of the box" framing                                                                                             |
| Available-plugins filter                 | `listAvailablePlugins` drops plugins whose `userScopedCapabilities` is empty                                  | Adds a second filter via `isNotificationOnlyPlugin` (shared/plugins/purpose.ts): plugins whose only user-scoped cap is `notificationDelivery` are owned by Settings → Notifications and excluded from the Connections catalog |
| Shared key hint on available card        | `hasSharedConfig` (reused `global_config` flag)                                                               | `adminSharedAvailable` (any enabled `plugin_shared_credentials` row)                                                                                          |
| Admin shared creds UI                    | Table already exists inside the Configure dialog's "Shared credentials" tab                                   | Same table lifted out of the dialog and onto the plugin card, visible without a click                                                                         |
| Admin manifest fields read               | `manifest.allowsSharedCredentials`, `manifest.credentialsSchema` used for shared-creds form                   | `manifest.sharedCredentialsSchema`, `manifest.poolable` (legacy flag already gone server-side)                                                                |
| `personalKeyFallback`                    | Present on `PluginRow` but unrendered; no UI                                                                  | New admin control on the card — segmented switch, disabled for pure-global plugins                                                                            |
| Pool-state meta line                     | No way to compute `enabled/total` without a second query                                                      | New `sharedCredentialsEnabledCount` added **and** existing `sharedCredentialsCount` widened to mean total (see row above) — together they drive the meta line |
| Card display fields                      | Frontend parses `userConfigSchema` and merges with decrypted `user_config`                                    | Backend returns `displayFields: Array<{ label, value, mono? }>` directly                                                                                      |
| "Connected" card for pure-global plugins | Empty card can be created with no credentials                                                                 | Pure-global plugins are filtered server-side out of `/connections`; their surface is admin-only                                                               |
| Empty-credentials rows                   | Allowed (TMDB created them on empty submit)                                                                   | Rejected by backend with typed `plugin.credentials_empty`; frontend surfaces it as a field error                                                              |
| Duplicate shared-credential label        | No explicit constraint                                                                                        | Rejected by backend with typed `plugin.duplicate_label`; surfaced inline on the label field                                                                   |
| Ephemeral credential test                | Only stored entries can be tested; `Test & save` in admin dialog would have to save-then-test                 | New `POST /api/plugins/:id/shared-credentials/test-ephemeral` validates an unsaved value                                                                      |
| Client response typing                   | Hand-written per-page types (`PluginRow`, `AvailablePlugin`, `ConnectionItem`, `SharedCredentialEntry`, etc.) | Inferred from the Hono client via `InferResponseType<typeof api.x.$get>`                                                                                      |

## Revised data model consumed by the frontend

All types below are the shape the UI expects from RPC. They are generated from host Zod schemas; the refactor does not hand-write them.

```ts
export type CapabilityEntry = {
  id: string; // e.g. "watchHistory"
  version: string; // e.g. "v1"
  scope: "global" | "user";
};

// User-facing plugin shape. Returned by `GET /api/connections/available` and
// embedded in every `ConnectionSummary.plugin`. Everything the user surfaces
// (available cards, connected cards, connection modal) renders off of this.
// Admin-only fields (`hasGlobalConfig`, source type, install date) live on
// `PluginRow` instead — a user never needs them.
export type PluginSummary = {
  id: string;
  name: string;
  version: string;
  description: string;
  logoUrl?: string;
  authKind: "form" | "oauth_redirect" | "oauth_device" | "none";
  poolable: boolean;
  // Split for display. Never merged — UI decides where each goes. These
  // scoped arrays deliberately **omit `scope`** (it's implicit from which
  // array the entry lives in); use `Array<Omit<CapabilityEntry, "scope">>`
  // — i.e. `{ id: string; version: string }[]`, which matches what
  // `listAvailablePlugins` already returns at `service.ts:363-364`. The flat
  // `PluginRow.capabilities` array below keeps `scope` because it isn't
  // partitioned. Implementers: do not re-stamp `scope` when splitting on the
  // server.
  userScopedCapabilities: Array<Omit<CapabilityEntry, "scope">>;
  globalScopedCapabilities: Array<Omit<CapabilityEntry, "scope">>;
  userConfigSchema?: JSONSchema;
  // Needed by the connection modal for form-auth plugins to render the
  // credentials form. Already returned by `/connections/available` today;
  // added to the embedded `plugin` on `/connections/` in this PR for
  // reconnect flows.
  credentialsSchema?: JSONSchema;
  // True iff the admin pool has ≥1 enabled entry. Drives "using server key" copy.
  adminSharedAvailable: boolean;
};

export type ConnectionSummary = {
  id: string;
  pluginId: string;
  displayName: string | null;
  status: "connected" | "expired" | "error" | "disconnected";
  enabled: boolean;
  isDefault: boolean;
  tokenExpiresAt: number | null;
  lastVerifiedAt: number | null;
  errorMessage: string | null;
  // Backend-computed; `userConfigSchema` + decrypted user_config with any
  // `x-secret` field removed. UI renders as a definition list. Empty array
  // when the plugin has no non-secret user config.
  //
  // Note: not present on `GET /api/connections/` today — the server returns
  // raw `userConfig` + schema and the client walks it. This PR introduces the
  // field alongside the frontend refactor so the client stops walking schemas.
  displayFields: Array<{ label: string; value: string; mono?: boolean }>;
  // Full PluginSummary for the plugin this connection belongs to.
  //
  // Note: today the embedded plugin on connection rows carries the legacy
  // `capabilities: string[]` ("watchHistory@v1"). This PR widens it to the
  // scoped arrays the rest of the UI uses, so the connection card can render
  // scope-grouped badges without a separate plugin lookup.
  plugin: PluginSummary;
};

export type SharedCredentialEntry = {
  id: string;
  label: string;
  enabled: boolean;
  lastExhaustedAt: number | null;
  retryAfter: number | null; // unix seconds; null or past = ready
  createdAt: number;
  updatedAt: number;
};

// Shape of rows returned by `GET /api/plugins/`. Mirrors the server rather
// than flattening: name/description/logoUrl/authKind live under `manifest`
// as they do server-side, so the client reads them as `plugin.manifest.name`
// etc. Do NOT reshape in the client into a flat object — adds drift surface
// for no benefit.
export type PluginRow = {
  id: string;
  version: string;
  sourceType: "builtin" | "url";
  isBuiltin: boolean;
  enabled: boolean;
  installedAt: number;
  updatedAt: number;
  // Scoped capability list, already split on the server.
  capabilities: CapabilityEntry[];
  // True when every capability has `scope: "global"`. Already computed server-side.
  isPureGlobal: boolean;
  poolable: boolean;
  hasGlobalConfig: boolean;
  // Total entries (any enabled state). NOTE: today the server's
  // `sharedCredentialsCount` field holds the *enabled* count (the service
  // calls `countEnabled`). The bundled server change in this PR widens
  // `sharedCredentialsCount` to mean "total" and introduces the new
  // `sharedCredentialsEnabledCount` below. See Migration step 1.
  sharedCredentialsCount: number;
  sharedCredentialsEnabledCount: number;
  personalKeyFallback: "off" | "admin-first" | "personal-first";
  // Full manifest. Clients read display strings + schemas off of this.
  manifest: PluginManifest;
};
```

Shapes are consumed by the same RPC endpoints already in use; the bundled server change in this PR extends the payloads without renaming existing fields. Two fields disappear on the frontend side after the refactor: `hasSharedConfig` (ambiguous; replaced with `adminSharedAvailable` + `hasGlobalConfig`) and `capabilities: string[]` (replaced with the two scoped arrays).

The client stops hand-writing these interfaces and starts deriving them via `InferResponseType<typeof api.x.$get>` from the existing Hono client. See the _Type inference_ sub-section of Migration below.

### `displayFields` extraction (server-side rules)

The backend helper that produces `displayFields` from a plugin's `userConfigSchema` + decrypted `userConfig` follows these rules:

- **Source:** properties of `userConfigSchema`, in declaration order (`Object.keys(schema.properties)`). No alphabetical sort; schema order wins.
- **Exclude entirely:** properties with the JSON Schema hint `x-secret: true`. These never appear in `displayFields`. Matches the current client-side `nonSecretFields` behavior.
- **Include but redact:** properties with the JSON Schema hint `x-private: true`. Value is replaced with `"••••"` (four bullets) and the field still appears; the user knows the value exists without seeing it. New behavior; no current counterpart.
- **`label`:** `property.title` if present, otherwise a titlecase of the property name (`base_url` → `Base URL`, `apiKey` → `API Key`). Match the current client helper's fallback so UI doesn't shift.
- **`value`:** stringified as follows — strings pass through; numbers via `String(n)`; booleans as `"Yes"` / `"No"`; arrays of primitives joined with `", "`; `null` / `undefined` / missing key → empty string `""` (the property still appears so the user knows it's unset). Objects and nested shapes are out of scope (the schema renderer doesn't support them anyway).
- **`mono: true`** set for:
  - Properties with JSON Schema `format: "uri"` or `format: "url"`.
  - Properties declaring the hint `x-mono: true`.
  - Properties with `x-allowed-host` (these are always URLs in current plugins).
  - Otherwise omitted (the client treats `mono` as falsy by default).
- **Empty result:** If a plugin has no `userConfigSchema` or every property is `x-secret`, the helper returns `[]`. The connection card renders no definition list — not an empty placeholder.

The helper lives next to the connection serializer; a server test fixture covers each of the bullet points above.

## Capability display map

The existing `CAPABILITY_DISPLAY` table in `packages/client/src/lib/capabilities.ts` stays and gains nothing new. The file already covers `metadata`, `watchHistory`, `watchlist`, `ratings`, `recommendations`, `calendar`, `mediaRequest`, and `idResolve` with fallback to `titleize(id)`.

The refactor introduces one helper next to it:

```ts
export function renderCapabilityBadges(
  entries: CapabilityEntry[],
  opts?: { size?: "sm" | "md" },
): ReactNode;
```

Used wherever capabilities are rendered. Visual weight unchanged from today. No scope indicator is painted on the badge itself — scope is conveyed by _where_ the badge appears (grouped under the section heading it belongs to), not _what_ the badge looks like.

## `/connections` page

### High-level layout

Matches today's structure: header, optional alert banner, **Your Connections** block, **Available to Connect** block, empty states. Five targeted changes:

1. **Header subtitle** unchanged. `Manage plugins` link unchanged.
2. **Alert banner** unchanged in behaviour. Use `destructive` when any `status === "error"`, warning styling when only `expired`.
3. **Your Connections grouping**: section order unchanged (broken groups float; alphabetical by plugin name otherwise).
4. **Capability badges on the group header** now render **only `userScopedCapabilities`**. A connection earns a user what its user-scoped capabilities expose; global capabilities from the same plugin are not connection-gated and live in the Available section's framing instead.
5. **Connection card body** renders `connection.displayFields` verbatim — no schema walk, no `x-secret` filtering in the frontend. The existing `nonSecretFields` helper in `schema-form.tsx` is deleted along with the card-side schema parsing.

### "Available to Connect" block

Backed by `GET /api/connections/available`. `listAvailablePlugins` in `apps/server/src/connections/service.ts` applies two filters: (1) it skips any plugin whose `userScopedCapabilities` is empty (pure-global plugins like TMDB/TVDB v2 never appear); (2) it skips notification-only plugins — those whose sole user-scoped capability is `notificationDelivery` (Telegram, Discord, ntfy in v1). Notification-only plugins are owned by Settings → Notifications instead. Plugins that mix `notificationDelivery` with another user-scoped capability remain visible here. The classifier lives in `packages/shared/src/plugins/purpose.ts` as `classifyPluginPurpose` / `isNotificationOnlyPlugin` and is reused by the manifest validator.

Each available card shows:

- Plugin name (+ optional tiny logo).
- One-line description, truncated.
- **User-scoped capability badges.** Rendered with the same label/icon mapping as today.
- If `plugin.globalScopedCapabilities.length > 0`, a muted one-line footer: `"{cap1}, {cap2} available without a connection"` — capped at three, then "+N more". Conveys that the plugin has value even without the user acting, which matters for mixed plugins. Among current built-ins only Trakt is mixed (all capabilities `user`-scoped except `idResolve` which is `global`), but the affordance is manifest-driven so any future mixed plugin inherits it. Purely cosmetic; no state attached.
- Primary action:
  - If `adminSharedAvailable === true` **and** the plugin has user-scoped capabilities: a muted inline `<KeyIcon /> Using server key` label on the left, with an **`Add your own key`** outline button on the right. Opens the Connection Modal in create mode. Copy: "Unlock your personal {plugin.name} features" when hovered (tooltip).
  - Otherwise: the existing `Connect` primary button.

`hasSharedConfig` in today's code was repurposed sloppily (it currently tracks plaintext `global_config`, not admin shared credentials). The refactor replaces it with `adminSharedAvailable` and deletes the field. The visual affordance is the same; only the source of truth changes.

### Connected instance card

Layout and actions unchanged. Internal changes:

- Remove the `useMemo` that parses `plugin.userConfigSchema` and merges with `connection.userConfig`. Render `connection.displayFields` directly.
- Status badge logic unchanged.
- `Reconnect` branches on `authKind` (the branch landed after this PR — at this doc's time both kinds opened the edit modal): `form` → edit modal (re-enter credentials → test → save, which re-verifies and flips the broken `status` back to `connected`); `oauth_*` → the same `<ConnectionModal>` in reconnect mode (`reconnect` prop), re-running the auth ceremony rather than the display-name-only OAuth edit. On OAuth completion the server rebinds the fresh credentials to the user's existing non-poolable connection instead of inserting a duplicate. The form prefill still reads from `GET /api/connections/:id/user-config` (unchanged); `connection.displayFields` is card-only and intentionally redacts `x-private` fields, so it cannot be used to populate the form. `displayFields` replaces the card's `useMemo` schema-walk, not the modal's prefill query.
- `Remove` dialog copy unchanged.
- Dropdown: remove the legacy "Set as default" visibility rule tied to plugin-id and rely on `plugin.poolable` instead. The new visibility condition is `plugin.poolable || group.connections.length > 1`: poolable plugins always surface the control (rotation assumes a default even with a single entry), and non-poolable plugins surface it once the user has multiple instances (no rotation, but the "default" concept is still meaningful for disambiguating which one is authoritative). In practice all current plugins either are poolable or have one instance, so the behaviour doesn't regress.

### Empty states

Unchanged copy and layout. Two notes:

- `NoPluginsState` is shown when `plugin.listAvailable` returns zero entries. A server with installed plugins but _all_ pure-global will also trigger this — the copy still makes sense ("no plugins to connect to") because the user genuinely has nothing to act on.
- `EmptyConnectionsState` uses the same `AvailablePluginCard` component so "Connect" / "Add your own key" dual behaviour is inherited.

### Connection modal

Matches today's modal in structure (single dialog, four body variants, device-code panel, edit mode). The refactor adjusts the create/edit flow to respect three new invariants:

- Empty-credentials submissions are rejected by the backend with typed error `plugin.credentials_empty` (payload `{ field: string }` — the first required field that was blank). The modal maps that error to a top-of-form inline message: `"Credentials can't be blank. Enter a {field.title} to continue."` and passes `{ [error.params.field]: "..." }` to `SchemaForm`'s `serverErrors` so the field itself is highlighted.
- Invalid base URLs are rejected with typed error `plugin.invalid_base_url` (payload `{ field: string }` — the URL field that failed). The modal reads the `field` off the error payload and threads it through `SchemaForm`'s `serverErrors` so the correct URL input is highlighted when the plugin has more than one URL-typed field.
- For `form` auth in edit mode on a plugin with an `x-secret` field: the "Leave blank to keep current value" placeholder stays; the bespoke secret-preserve logic in `stripEmptySecrets` stays. If the user submits the form with both an unchanged secret and no other changes, the save call short-circuits client-side to only update `displayName`.

Capability badges in the modal header render **both** scoped arrays, but grouped:

- User-scoped badges at normal opacity (what the connection unlocks).
- A muted line below: `"Also provides {list} without a connection"` if `globalScopedCapabilities` is non-empty. Prefixed with a visually-hidden `<span className="sr-only">Also available without a connection:</span>` so screen readers announce the grouping rather than reading a sentence fragment.

Rationale: mixed plugins (Trakt today, hypothetical future ones) benefit from being honest in the create flow — the user sees which capabilities are already live globally and that _adding a connection_ unlocks the user-scoped ones.

## `/admin/plugins` page

The page structure — title, subtitle, install button (stub), list-of-cards — stays. The card's information density grows to surface the pool and fallback policy without spawning new pages.

As of finalization, the client already renders a shared-credentials table inside `ConfigureDialog` with per-row enable/disable/test/edit/delete and inline cooldown copy. This refactor **lifts that table out of the dialog** onto the plugin card; it does not introduce a new table from scratch. `ConfigureDialog` collapses to a single-purpose global-config dialog.

### Plugin card, revised

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 🎞 Trakt  v1.4.2  [Built-in]  [Enabled ✓]                        ⋯ menu │
│ Watch history, watchlist, and ratings sync for movies and TV.            │
│                                                                          │
│ ◎ Global: [ID Resolution]                                                │
│ ◎ User:   [Watch History]  [Watchlist]  [Ratings]  [Calendar]  [+4]      │
│                                                  Auth: oauth_device      │
│                                                                          │
│ Connections: 3  ·  Installed 2026-04-12  ·  Pool: 1/1 enabled            │
├──────────────────────────────────────────────────────────────────────────┤
│ Shared credentials (admin-owned pool)              [ + Add credential ]  │
│ ┌──────────────────────────────────────────────────────────────────────┐ │
│ │ Primary app credentials  Enabled  ✓ Ready          Test  Edit  ⋯    │ │
│ └──────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│ Personal key fallback:  ( off )  ( admin-first )  ( personal-first )     │
│ Admin-owned keys are tried first; users' own keys only kick in when …   │
└──────────────────────────────────────────────────────────────────────────┘
```

Trakt is the only mixed built-in plugin today and is non-`poolable`, so the pool table holds at most one entry. For a hypothetical future poolable mixed plugin the same layout renders multiple rows with per-entry cooldown state (e.g. `⧗ Retry in 02:14` replacing `✓ Ready`).

Breakdown:

- **Header row.** Name (`plugin.manifest.name`), version (`plugin.version` — this is the installed version, not `manifest.version`; they may diverge), source badge ("Built-in" / "URL" driven by `plugin.isBuiltin` / `plugin.sourceType`), enabled switch (`plugin.enabled`), dropdown menu. Dropdown now contains: `Configure global config` (only when `plugin.manifest.globalConfigSchema` exists), `Set personal key fallback…` (only for plugins with any user-scoped capability), `Update…` (stub), `Rollback to previous version` (stub, disabled if no prior), `Uninstall` (hidden for built-ins). "Configure shared credentials" is gone; shared credentials are inline.
- **Scope rows.** Two lines of capability badges, one per scope. The admin's `PluginRow.capabilities` is a single flat array; the card splits it client-side into `userScoped` / `globalScoped` by filtering on `entry.scope`. If either bucket is empty the whole row is omitted. Rendered with `renderCapabilityBadges`. A tiny ◎ glyph or label (`Global:` / `User:`) carries the distinction; no icon differentiation inside the badge.
- **Meta line.** `Connections: N · Installed …` — same as today. Appends `· Pool: {sharedCredentialsEnabledCount}/{sharedCredentialsCount} enabled` whenever the plugin has `manifest.sharedCredentialsSchema` and `sharedCredentialsCount > 0`, irrespective of `poolable` (non-poolable plugins will show `1/1` or `0/1`; the copy still fits). The counts come directly off `PluginRow`, so the meta line renders immediately without waiting for the shared-credentials list query. Per-row cooldown state is shown on the row itself inside the table below, not in the meta line. The `Pool:` fragment is omitted entirely when `sharedCredentialsCount === 0` (the empty-state row inside the section covers that case).
- **Shared credentials section.** Omitted entirely when `plugin.manifest.sharedCredentialsSchema` is absent. Otherwise a compact table of entries:
  - Label (editable).
  - Enabled toggle inline (right aligns a small `Switch`).
  - Status pill: `Ready`, `Retry in mm:ss`, or `Disabled`.
  - `Test` button (calls `POST /api/plugins/:id/shared-credentials/:credId/test` — the stored-entry endpoint, distinct from the ephemeral one used by the create/edit dialog's `Test & save`). Result renders inline for 3s, same pattern as the connection card's test button.
  - `Edit` opens a small dialog with the `sharedCredentialsSchema` form.
  - Dropdown: `Rename`, `Delete`.
  - Poolable plugins can hold many entries. Non-poolable plugins (e.g. hypothetical admin-owned single-key variants) show the same table but `+ Add credential` is disabled when one entry already exists — the button's tooltip reads `"This plugin only supports one shared credential."`
  - Empty state inside the section: single muted line `"No shared credentials configured. {Global-scoped, ±User-fallback} capabilities will return CAPABILITY_UNAVAILABLE until one is added."` with a primary `Add credential` button.
- **Personal key fallback row.** Renders only for plugins where the policy can actually do something — i.e. plugins that declare a `sharedCredentialsSchema` (so an admin pool exists) **and** either have at least one user-scoped capability or are pure-global. Plugins like Plex / Jellyfin / Seerr that declare no `sharedCredentialsSchema` at all (purely user-side, nothing for the admin to fall back to or from) skip the row entirely — the only sensible policy there is `off` and rendering the control would suggest an option the admin can't actually use. A segmented control (three buttons) mapped to `"off" | "admin-first" | "personal-first"`. Below the control a one-line muted explainer that swaps based on the current policy:
  - `off`: `"Admin and user keys are kept separate. Global calls use the admin pool; user calls use the user's own keys only."`
  - `admin-first`: `"Admin-owned keys are tried first; users' own keys only kick in when the admin pool is exhausted for that call."`
  - `personal-first`: `"Users' own keys are tried first; admin-owned keys only fill in when the user's pool is exhausted."`
    Changing the value calls `PATCH /api/plugins/:id/personal-key-fallback` (already implemented server-side). Disabled for pure-global plugins with a tooltip: `"Only applies to plugins with user-scoped capabilities."`

### Disabled plugins

Visual treatment unchanged (opacity 60%). All interactive sub-controls (add credential, fallback policy, per-credential test) remain operable — admin may want to fix config before re-enabling.

### Add / Edit shared credential dialog

A shadcn `Dialog`. Title: `"Add shared credential for {plugin.manifest.name}"` or `"Edit shared credential"`. Body:

- `Label` text input (required). Placeholder: `"e.g. Primary key"`.
- `Enabled` switch, default `true` on create.
- `SchemaForm` rendering `plugin.manifest.sharedCredentialsSchema`. Secret-field handling is identical to the existing user connection flow (masked input, show/hide toggle, "leave blank to keep current value" on edit).
- Footer: `Cancel`, `Test & save` (primary), `Save without test` (outline, smaller).

`Test & save` calls the new **ephemeral** test endpoint against the unsaved value: `POST /api/plugins/:id/shared-credentials/test-ephemeral`, returning `{ ok: boolean; message?: string }`. Landing in the same PR as the client refactor so the dialog never has to save-then-test.

The alternative (save then test then delete on fail) was explicitly rejected — it risks dangling enabled rows during the test window and makes the "row is red for 2s" UX hard to reason about.

Implementation: reuses the manifest's `verifyShared` / `testConnection` handler path from the existing `testSharedCredential` procedure; the only difference is it accepts the raw candidate value instead of fetching by ID. Auth gate is the same (admin only).

### Configure global config dialog

The existing tabbed dialog is removed. Global config becomes its own single-purpose dialog triggered from the card's dropdown. Body is a `SchemaForm` rendering `plugin.manifest.globalConfigSchema`. No credentials tab. No shared credentials blob. Admin always has one save button.

This is a notable simplification: today `ConfigureDialog` in `admin/plugins.tsx` conditionally switches tabs between `config` and `credentials`. That branch goes away; the dialog collapses to the `config`-only path. The `credentials` path is replaced by the inline shared-credentials table described above.

### Install modal (stub)

Kept out of scope for v1 per the existing code comment. The `Install Plugin` button in the header becomes a stub that opens a dialog explaining "Built-in plugins register on boot; URL install will ship in a later version." When the backend install path is wired, the dialog body will grow into the step list from the previous design doc — no structural change required here.

### Uninstall dialog

Unchanged. Typed-name confirmation, destructive copy, cascade warning.

## SchemaForm — minor extensions

The bespoke renderer is kept. Three small extensions land as part of this refactor, driven by the shared-credentials form:

1. **Add-vs-edit mode semantics hold across all call sites.** Today the component already takes `mode`. The shared-credentials create dialog passes `mode="create"` (no "leave blank" placeholder); the edit dialog passes `mode="edit"`.
2. **`stripEmptySecrets`** stays. Shared-credentials edit uses it to preserve untouched secrets, matching the user flow.
3. **Server-error injection.** Already supported via the `serverErrors` prop. The only change is that `connections.ts` procedure errors now come back with `fieldErrors: { [name]: message }` and the modal threads them through to the `SchemaForm`. The current code already passes `serverErrors` but never receives anything non-empty; the contract is honoured once the backend starts returning typed errors (`plugin.credentials_empty`, `plugin.invalid_base_url`, `plugin.duplicate_label`). These land in the same PR as the client work.

The "what it does NOT support" list from the prior doc holds: no `oneOf`/`allOf`/`anyOf`, no nested objects or arrays, no `$ref`, no custom widgets beyond the table in the old doc.

`nonSecretFields` is **deleted**. The only caller (the connection card's schema-walking display) is replaced by `connection.displayFields`.

## API call inventory (for the refactor)

Existing endpoints, unchanged surface:

- `GET  /api/connections/`
- `GET  /api/connections/available`
- `GET  /api/connections/:id/user-config`
- `POST /api/connections/verify-config`
- `POST /api/connections/`
- `PATCH /api/connections/:id/display-name`
- `PATCH /api/connections/:id/user-config`
- `PATCH /api/connections/:id/enabled`
- `POST /api/connections/:id/default`
- `POST /api/connections/:id/test`
- `DELETE /api/connections/:id`
- `POST /api/connections/oauth/device/start`
- `POST /api/connections/oauth/device/poll`
- `POST /api/connections/oauth/redirect/start`
- `POST /api/connections/oauth/redirect/complete`

Existing endpoints, existing surface, new fields in response (all land in this PR's bundled server change):

- `GET  /api/plugins/` — already returns `sharedCredentialsCount`, `personalKeyFallback`, `poolable`, and scoped `capabilities: Array<{id,version,scope}>`. **Adds `sharedCredentialsEnabledCount`** in this PR to power the `Pool: {enabled}/{total} ready` meta line.
- `GET  /api/connections/available` — already returns `userScopedCapabilities`, `globalScopedCapabilities`, `adminSharedAvailable`, `poolable`, `userConfigSchema`, `credentialsSchema`; `hasSharedConfig` is already removed; pure-global plugins are filtered out (the `userScopedCapabilities.length === 0` check in `listAvailablePlugins`); notification-only plugins (sole user-scoped cap = `notificationDelivery`) are also excluded so the Notifications settings page can own them via `GET /api/notifications/plugins`. One field rename in this PR: `auth` → `authKind` so the endpoint and `/connections/`'s embedded plugin share the `PluginSummary` shape.
- `GET  /api/connections/` — **adds `displayFields: Array<{label, value, mono?}>`** on each connection (today the server returns raw `userConfig` + schema). Embedded `plugin` object widened from the current `capabilities: string[]` to full `PluginSummary` shape with scoped arrays.

Existing admin endpoints used by the revised UI:

- `GET    /api/plugins/:id/global-config`
- `PUT    /api/plugins/:id/global-config`
- `GET    /api/plugins/:id/shared-credentials`
- `POST   /api/plugins/:id/shared-credentials`
- `PATCH  /api/plugins/:id/shared-credentials/:credId`
- `DELETE /api/plugins/:id/shared-credentials/:credId`
- `POST   /api/plugins/:id/shared-credentials/:credId/test`
- `PATCH  /api/plugins/:id/personal-key-fallback`

New admin endpoint added in this PR:

- `POST   /api/plugins/:id/shared-credentials/test-ephemeral` — accepts a candidate credential value conforming to `manifest.sharedCredentialsSchema`, runs the plugin's verifier, returns `{ok, message?}` without persisting.

### Typed error codes

The bundled server change adds three error codes so form validation surfaces as inline field errors rather than generic toasts. Codes live alongside existing host error codes in `packages/server/src/errors/codes.ts`:

- `plugin.credentials_empty` — thrown from the connection create/verify path when required credential fields are submitted blank. Replaces today's generic `connection.verify_failed` for this specific case. Surfaced in `ConnectionModal` as a top-of-form field error: `"Credentials can't be blank. Enter a {field.title} to continue."`
- `plugin.duplicate_label` — thrown from `POST /api/plugins/:id/shared-credentials` when an admin tries to add an entry whose label matches an existing entry (case-insensitive). Surfaced inline on the Label field of the shared-credential dialog.
- `plugin.invalid_base_url` — thrown from connection create when a plugin's `x-allowed-host` schema hint rejects the submitted base URL. Surfaced as a field error on the offending URL field.

The existing `plugin.not_poolable` code (already defined, already thrown when a non-poolable plugin gets a second shared credential) continues to be surfaced inline on the label field with "This plugin only supports one shared credential."

Frontend work wires each of these; the RPC client surfaces them via typed error objects on the response.

## File-by-file refactor plan

```
packages/client/src/
├── lib/
│   └── capabilities.ts                    UNCHANGED + add renderCapabilityBadges helper
├── components/connections/
│   ├── schema-form.tsx                    Delete nonSecretFields; no other changes
│   └── connection-modal.tsx               Use scoped capability arrays in header; map
│                                          plugin.credentials_empty and
│                                          plugin.invalid_base_url to field errors
└── routes/_authenticated/
    ├── connections.tsx                    Drop schema walk; use displayFields. Swap
    │                                      hasSharedConfig → adminSharedAvailable.
    │                                      Render userScopedCapabilities on group
    │                                      headers. Available cards gain a muted
    │                                      "also provides X globally" footer.
    └── admin/plugins.tsx                  Rewrite PluginCard with scope rows, inline
                                           shared-credentials table, personalKeyFallback
                                           control. Remove credentials tab from the
                                           Configure dialog (now global-config only).
                                           Add SharedCredentialDialog component.
```

New component to introduce (co-located with `admin/plugins.tsx`):

- `<SharedCredentialsSection plugin={plugin} onChange={refetch} />` — the inline pool table.
- `<SharedCredentialDialog plugin={plugin} existing?={entry} … />` — create/edit dialog.
- `<PersonalKeyFallbackControl plugin={plugin} onChange={refetch} />` — segmented control + explainer.

The current `admin/plugins.tsx` is ~948 lines. Lifting the shared-credentials table out of the Configure dialog and collapsing the dialog to global-config-only should net out roughly flat after `<PersonalKeyFallbackControl>` and the reorganized `<SharedCredentialsSection>` land. If the file crosses ~1100 lines during the rewrite, extract `<SharedCredentialsSection>` and `<SharedCredentialDialog>` to `packages/client/src/components/admin/shared-credentials/`.

## Interaction summary

| Action                                                    | Flow                                                                                                                          |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Add connection (form, plugin with `adminSharedAvailable`) | Available card → "Add your own key" → modal → fill → test → save → card appears. Global capabilities keep working throughout. |
| Add connection (form, no admin shared)                    | Available card → "Connect" → modal → fill → test → save → card appears.                                                       |
| Add connection (OAuth redirect)                           | Unchanged.                                                                                                                    |
| Add connection (OAuth device)                             | Unchanged.                                                                                                                    |
| Edit connection                                           | Unchanged.                                                                                                                    |
| Remove connection                                         | Unchanged.                                                                                                                    |
| Reconnect                                                 | Changed after this PR: `form` → edit modal; `oauth_*` → reconnect modal re-runs auth ceremony → server rebinds existing connection. |
| Test connection                                           | Unchanged.                                                                                                                    |
| Set as default                                            | Unchanged (visibility now keyed to `poolable`).                                                                               |
| Disable/enable                                            | Unchanged.                                                                                                                    |
| Admin add shared credential                               | Card → `Add credential` → dialog → test & save → row appears in table.                                                        |
| Admin edit shared credential                              | Row → `Edit` → dialog → save → row updates.                                                                                   |
| Admin enable/disable shared credential                    | Row inline switch → row status updates.                                                                                       |
| Admin delete shared credential                            | Row → `⋯` → `Delete` → confirm AlertDialog → row removed.                                                                     |
| Admin test shared credential                              | Row → `Test` → inline result (3s auto-dismiss).                                                                               |
| Admin set personal-key fallback                           | Segmented control → `PATCH /personal-key-fallback` → explainer copy updates.                                                  |
| Admin set global config                                   | Card menu → `Configure global config` → dialog → save.                                                                        |
| Admin uninstall                                           | Card menu → `Uninstall` → typed-name AlertDialog → cascade.                                                                   |

## Responsive layout

- **`lg+`**: plugin card renders full width within the admin page's single column (the cards-in-list shape today). Shared credentials table renders as-is; each row wraps gracefully if the label is long.
- **`md`**: shared credentials table columns collapse — `Label / Status / Actions`, with Enabled switch folded into the actions dropdown. Personal-key fallback segmented control wraps to two rows if needed.
- **`sm`**: every admin card becomes full-width; the pool table becomes a stack (one entry = one small panel, not a table row). Capability scope lines stay but wrap tightly.
- `/connections` responsive rules are unchanged from the prior doc.

## Accessibility

- Scope lines carry visually-hidden `<span className="sr-only">Global capabilities:</span>` prefixes so screen readers announce grouping.
- Segmented fallback control uses `<RadioGroup>` semantics. Active state has `aria-checked`.
- Shared credential status pill (`Retry in mm:ss`) has `aria-live="polite"` on the containing row so cooldown changes are announced.
- All new dialogs trap focus and return focus on close (shadcn default).
- Device-code panel's `userCode` `aria-label` unchanged from current implementation.

## States and feedback

### Loading / empty / error states

- `<SharedCredentialsSection>` — while the initial `GET /shared-credentials` is pending, render a muted single-row skeleton (same height as a real row) inside the section. On fetch error, render a muted `"Couldn't load shared credentials. [Retry]"` single-line; the retry button re-runs the query. Empty state (zero entries) is spec'd separately under the Admin page section.
- `<PersonalKeyFallbackControl>` — no loading state (value comes from `PluginRow` which is already hydrated by the time the card renders). On mutation failure, revert the segmented switch to its previous value and show a destructive toast `"Couldn't update fallback policy. Try again."`; the control remains enabled.
- `<SharedCredentialDialog>` — `Test & save` shows a spinner on the button while the ephemeral test is in flight; the button label flips to `"Testing…"`. On `{ok: false}` the error message is surfaced inline at the top of the body (not a toast) and the `Save without test` button becomes the primary action so the admin can choose to proceed anyway. `Cancel` closes with no side-effect.
- Connection modal — unchanged initial loading path. On mutation failure that returns a typed error with a `field` payload, the error is injected into `SchemaForm`'s `serverErrors` and the offending field scrolls into view.

### Optimistic updates and rollback

- Optimistic: the enabled toggle on both plugin cards and shared-credential rows. On mutation error the toggle reverts and a destructive toast surfaces.
- Server-authoritative: creates, deletes, `Test & save`, global-config save, personal-key-fallback PATCH. UI shows pending state (spinner / disabled) until server confirms.

### TanStack Query invalidation map

Existing key conventions in the client (verify before writing): admin surfaces use `["admin", "plugins", ...]`; user surfaces use `["connections", ...]` / `["connections", "available"]`. Below uses these conventions; any new mutation keys follow the same shape so prefix invalidation works correctly.

| Mutation                                                  | Invalidates                                                                                                                                                                                    |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/plugins/:id/shared-credentials`                | `["admin", "plugins"]` (refreshes `sharedCredentialsCount` + `sharedCredentialsEnabledCount` meta line) **and** `["admin", "plugins", id, "shared-credentials"]` (refreshes the section rows). |
| `PATCH /api/plugins/:id/shared-credentials/:credId`       | `["admin", "plugins", id, "shared-credentials"]` only. If the patch toggles `enabled`, also invalidate `["admin", "plugins"]` so the meta line re-renders.                                     |
| `DELETE /api/plugins/:id/shared-credentials/:credId`      | Both `["admin", "plugins"]` and `["admin", "plugins", id, "shared-credentials"]`.                                                                                                              |
| `POST /api/plugins/:id/shared-credentials/:credId/test`   | None — result is surfaced inline from the mutation response; no server state changed.                                                                                                          |
| `POST /api/plugins/:id/shared-credentials/test-ephemeral` | None — explicitly does not persist.                                                                                                                                                            |
| `PATCH /api/plugins/:id/personal-key-fallback`            | `["admin", "plugins"]`.                                                                                                                                                                        |
| `PUT /api/plugins/:id/global-config`                      | `["admin", "plugins"]`.                                                                                                                                                                        |
| `POST /api/connections/`                                  | `["connections"]` and `["connections", "available"]`.                                                                                                                                          |
| `PATCH /api/connections/:id/*`                            | `["connections"]`. If the patch is `enabled` or `default`, also invalidate `["connections", "available"]` in case the filter results shift.                                                    |
| `DELETE /api/connections/:id`                             | Both `["connections"]` and `["connections", "available"]`.                                                                                                                                     |

### Countdowns

- Shared-credential cooldown countdowns are computed from `retryAfter` against a local `now` that ticks every second.
- A single `useNow(1000)` hook is added to `packages/client/src/hooks/use-now.ts`. `<SharedCredentialsSection>` calls `useNow(1000)` unconditionally on every render (Rules of Hooks); the hook itself inspects its caller-supplied "active" predicate and only schedules `setInterval` when at least one row has a future `retryAfter`. Otherwise it returns a stable timestamp and skips the timer entirely, avoiding per-second re-renders on the admin page when nothing is rate-limited. The signature is roughly `useNow(intervalMs: number, options?: { active?: boolean }): number` — the consumer passes `active: rows.some(r => r.retryAfter && r.retryAfter > Date.now() / 1000)`.

### Toasts vs inline errors

- Toasts (shadcn `Toast`/`Sonner`) for: shared credential saved, shared credential deleted, personal-key fallback updated, global config saved, and all optimistic-rollback failures.
- Inline errors for all typed field-level failures (`plugin.credentials_empty`, `plugin.invalid_base_url`, `plugin.duplicate_label`, `plugin.not_poolable`). Never duplicate an inline error as a toast.

## Testing

Follows the existing `vp test` harness.

**Server tests** (land alongside the client work in this PR):

- Connection serializer emits `displayFields` for a plugin with mixed secret + non-secret user config; secrets are absent.
- Connection serializer emits scoped capability arrays (not flat strings) on the embedded plugin object.
- `listAvailablePlugins` filters out a pure-global fixture plugin; mixed and user-only plugins remain.
- `listAvailablePlugins` filters out a notification-only fixture (sole user-scoped cap = `notificationDelivery`); mixed plugins that combine notification with another user-scoped capability remain.
- `listNotificationPlugins(ids)` returns full `PluginSummary` entries for the provided id set; consumed by `GET /api/notifications/plugins` so the picker hands an entry straight to `ConnectionModal` without a `/connections/available` round-trip.
- `GET /api/plugins/` returns `sharedCredentialsEnabledCount` matching a fixture of mixed enabled/disabled entries.
- `POST /api/plugins/:id/shared-credentials/test-ephemeral` returns `{ok: true}` for a valid candidate, `{ok: false, message}` for an invalid one, and **never persists** (follow-up `list` returns unchanged count).
- Connection verify throws `plugin.credentials_empty` for blank required fields; `plugin.invalid_base_url` for a URL that fails the `x-allowed-host` hint.
- Shared-credential create throws `plugin.duplicate_label` on a case-insensitive label collision; still throws `plugin.not_poolable` for a second entry on a non-poolable plugin.

**Client component tests:**

- `<SharedCredentialsSection>` renders ready, retry-pending, and disabled states; runs test; opens edit dialog; confirms delete.
- `<PersonalKeyFallbackControl>` renders all three states, calls the mutation, disabled for pure-global plugins.
- `/admin/plugins.tsx` full render given a `PluginRow` with: pure-global plugin, mixed plugin, user-only plugin.
- `<ConnectionModal>` still passes the existing suite plus three new cases: backend returns `plugin.credentials_empty` → inline field error; backend returns `plugin.invalid_base_url` → field error on URL input; plugin has `globalScopedCapabilities` → "also provides X" line rendered.
- `<SharedCredentialDialog>` calls `/test-ephemeral` (not the stored-entry `/test`) on `Test & save`; on `{ok: false}` no create call is issued and the error is surfaced inline.
- Connection card renders `displayFields` verbatim; no schema walk.

**E2E:**

- Admin configures a shared Trakt app credential via `Test & save` with a valid value (row appears), then retries with an invalid one (ephemeral test fails, nothing persisted), then toggles enable off and on, then deletes.
- Admin flips personal-key fallback across all three values on Trakt; explainer copy updates.
- User visits `/connections` with an admin-configured Trakt shared credential: "Using server key" shows on the Trakt available card; user authorizes via device flow; watch-history / watchlist / ratings capability badges appear on the connected card.
- User submits a blank connection form on Jellyfin → inline field error (not toast).

## Migration of existing code

This is a single PR. The client and server move together — field renames are breaking. Steps:

1. **Server additions** (all land first within the PR, before client code changes compile):
   - `GET /api/connections/` (`listForUser` in `packages/server/src/connections/service.ts`):
     - Add `displayFields: Array<{label, value, mono?}>` per connection. Extraction rules are spelled out in the _`displayFields` extraction (server-side rules)_ subsection earlier in this doc.
     - Widen the embedded `plugin` object from its current 9-field shape (`{id, name, version, description, auth, enabled, logoUrl, capabilities: string[], userConfigSchema}`) to match `PluginSummary`. Concrete field additions: `authKind` (rename of the current `auth`), `poolable`, `userScopedCapabilities` + `globalScopedCapabilities` (replacing `capabilities: string[]` — the legacy string array is removed), `adminSharedAvailable`, `credentialsSchema`. Drop the current `enabled` field on the embedded plugin since `/connections/` already filters to enabled plugins.
   - `GET /api/connections/available` (`listAvailablePlugins`):
     - Rename the field `auth` to `authKind` (same payload, new name) so the endpoint and `/connections/`'s embedded plugin converge on the `PluginSummary` shape. No behaviour change. Pure-global filter already in place (`userScopedCapabilities.length === 0`). Notification-only plugins are excluded via the shared `isNotificationOnlyPlugin` helper from `@ent-mcp/shared/plugins`; the Notifications settings page owns them through `GET /api/notifications/plugins`, which now serves the same `PluginSummary` shape plus `supportsKinds`.
   - `GET /api/plugins/` (`packages/server/src/api/procedures/plugins.ts`):
     - Flip `sharedCredentialsCount` from `countEnabled` to `countAll` (add the `countAll` helper on `sharedCredentialsService`).
     - Add `sharedCredentialsEnabledCount` sourced from the existing `countEnabled`.
     - No other field changes; `manifest` stays nested.
   - `POST /api/plugins/:id/shared-credentials/test-ephemeral` — new endpoint on `packages/server/src/api/procedures/plugins.ts`. Body validates against `manifest.sharedCredentialsSchema`; handler reuses the verifier path from `testSharedCredential` in `runtime.ts` but skips the DB fetch.
   - `packages/server/src/errors/codes.ts` — add `plugin.credentials_empty`, `plugin.duplicate_label`, `plugin.invalid_base_url`. Each throws with a `params: { field: string }` payload so the client maps them to the correct field. Wire throw sites: `credentials_empty` in the connection verify path when required fields are blank; `invalid_base_url` in the same path when an `x-allowed-host` hint rejects a URL field; `duplicate_label` in `sharedCredentialsService.create` on case-insensitive label collision.
2. Update `connection-modal.tsx` to consume scoped capabilities in the header; add the `plugin.credentials_empty` and `plugin.invalid_base_url` field-error mappings.
3. Update `connections.tsx`: delete the `useMemo` schema walk, consume `displayFields`, rename `hasSharedConfig` → `adminSharedAvailable`, update section headers to `userScopedCapabilities`, add "also provides" footer on available cards.
4. Rewrite `admin/plugins.tsx`:
   - Remove the tabbed `ConfigureDialog`; keep a global-config-only dialog.
   - Lift the existing shared-credentials table out of the dialog into a new `<SharedCredentialsSection>` rendered inline on the plugin card.
   - Extract `<SharedCredentialDialog>` to a standalone component; wire it to the new ephemeral-test endpoint.
   - Add `<PersonalKeyFallbackControl>`.
   - Replace any remaining references to legacy flags. Schemas are read as `plugin.manifest.sharedCredentialsSchema` / `plugin.manifest.globalConfigSchema` (still nested under `manifest`); `plugin.poolable` stays flat.
5. Delete `nonSecretFields` from `schema-form.tsx` and its import site on the connection card.
6. Extend `capabilityDisplay` helper with `renderCapabilityBadges`.

### Type inference

Every file touched by this refactor moves from hand-written response types to `InferResponseType<typeof api.x.$get>` via the existing Hono client (`packages/client/src/lib/api.ts` → `export const api = hc<AppType>(...)`).

Concretely, every hand-written `interface` / `type` currently declared at the top of each refactored file for an API response shape is deleted and replaced with an inferred alias. Every endpoint in this codebase wraps its list response in an envelope (`{ plugins: [...] }`, `{ connections: [...] }`, `{ entries: [...] }`), so the alias must index through the envelope key before reaching `[number]`. Target shapes:

- `PluginRow` interface in `admin/plugins.tsx` → `type PluginRow = InferResponseType<typeof api.plugins.$get>["plugins"][number]`.
- `SharedCredentialEntry` interface in `admin/plugins.tsx` → `type SharedCredentialEntry = InferResponseType<typeof api.plugins[":id"]["shared-credentials"].$get>["entries"][number]`. Note: Hono's generated types expose path params as their **literal string key** (here `":id"`, including the colon) — this is a type-level index, not a runtime call. Do not reach for `api.plugins.id[...]` or `api.plugins[":id"](id)[...]`; the colon-prefixed string is correct.
- `ConnectionItem` interface in `connections.tsx` → `type ConnectionItem = InferResponseType<typeof api.connections.$get>["connections"][number]`.
- `AvailablePlugin` interface in `connections.tsx` → `type AvailablePlugin = InferResponseType<typeof api.connections.available.$get>["plugins"][number]`.
- Any equivalent hand-written types in `connection-modal.tsx` follow the same envelope-indexed pattern against whichever endpoint they represent.

Envelope keys are verified against the current procedures and are the load-bearing part of each alias: `plugins` for `GET /api/plugins/` and `GET /api/connections/available`, `connections` for `GET /api/connections/`, `entries` for `GET /api/plugins/:id/shared-credentials`. If a new endpoint is added later, confirm its envelope key in `packages/server/src/api/procedures/{plugins,connections}.ts` before writing the alias.

This heals four pre-existing `tsc` errors caused by hand-written types drifting from server shapes. Keep inferred aliases scoped to the file where they're used unless a shape is shared across files — in which case lift to `packages/client/src/lib/types.ts` and re-export.

Non-goals:

- No `packages/shared`-level type export for these shapes. They are server response envelopes; the server is the source of truth.
- No attempt to migrate unrelated hand-written types in the client in the same PR. Stay within the four refactored files plus the lifted helper locations.

The previous design doc (`2026-04-19-frontend-connections-design.md`) stays in the repo as superseded; this file is the authoritative FE spec going forward.

## Open questions / deferred

Resolved during finalization (2026-04-23):

- ~~**Test-before-save for shared credentials.**~~ Resolved — `POST /api/plugins/:id/shared-credentials/test-ephemeral` lands in the same PR as the client refactor.

Still deferred:

- **Pool telemetry.** Per-entry cooldown is rendered inline; no aggregate charts. Revisit once multi-key rotation is live and telemetry shows skewed distribution.
- **Rollback UI.** The `Rollback to previous version` menu item is stubbed; wire once the backend rollback endpoint lands.
- **Bulk actions** on the admin page (e.g. test all shared credentials, disable all). Not needed in v1.
- **Activity log / audit trail** per connection and per shared credential. Deferred.
- **Logos for plugins.** Same policy as the prior doc: tiny (16-20px) next to the name, never dominant.
- **Pure-global plugin visual treatment on `/admin/plugins`.** They're admin-only (they don't appear on `/connections`) but there's no explicit visual indicator on the card that they're global-only. Spec is silent; worth revisiting if it becomes confusing.
- **Sub-issue carve-up.** Once finalized, the four workstream checkboxes from issue #36 (shared plumbing, user page, admin page, testing) each become a standalone issue. Sequencing follows the `Migration of existing code` step order.
