# Connections & Plugins UI — Revised Frontend Design

**Status:** Draft for agent execution
**Date:** 2026-04-22
**Author:** Omid Astaraki
**Supersedes:** `2026-04-19-frontend-connections-design.md`
**Companion:** `2026-04-19-plugin-architecture-design.md` (backend)

## Summary

The backend plugin architecture has been revised: capabilities now carry an explicit `scope` (`global` | `user`), admin-owned secrets live in a `plugin_shared_credentials` **pool** (multiple entries per plugin, with rotation and cooldown bookkeeping), and a per-plugin `personalKeyFallback` policy defines how the admin pool and a user's own keys interact for user-scoped calls. The bespoke `allowsSharedCredentials` flag is gone; pool-safety is expressed via `poolable`.

The current frontend still assumes the old shape. This document specifies how to refactor the two existing pages and their supporting components to drive entirely off the revised manifest and the revised oRPC surface.

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

## What changes vs. current code

| Area                                     | Old                                                                                         | New                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Capability listing                       | Flat `capabilities: string[]`                                                               | `capabilities: Array<{ id, version, scope }>`                                                    |
| Global capabilities                      | Not distinguished                                                                           | Rendered separately with muted "available out of the box" framing                                |
| Available-plugins filter                 | All enabled plugins                                                                         | Only plugins with at least one user-scoped capability                                            |
| Shared key hint on available card        | `hasSharedConfig` (reused `global_config` flag)                                             | `adminSharedAvailable` (any enabled `plugin_shared_credentials` row)                             |
| Admin shared creds UI                    | Single "Shared credentials" tab in Configure dialog                                         | Dedicated "Shared credentials" section on the plugin card — list of entries with per-row actions |
| Admin manifest fields read               | `manifest.allowsSharedCredentials`, `manifest.credentialsSchema` used for shared-creds form | `manifest.sharedCredentialsSchema`, `manifest.poolable`                                          |
| `personalKeyFallback`                    | N/A                                                                                         | New admin control, segmented switch, disabled for pure-global plugins                            |
| Card display fields                      | Frontend parses `userConfigSchema` and merges with decrypted `user_config`                  | Backend returns `displayFields: Array<{ label, value, mono? }>` directly                         |
| "Connected" card for pure-global plugins | Empty card can be created with no credentials                                               | Pure-global plugins are filtered out of `/connections`; their surface is admin-only              |
| Empty-credentials rows                   | Allowed (TMDB created them on empty submit)                                                 | Rejected by backend; frontend surfaces the typed error inline on the form                        |

## Revised data model consumed by the frontend

All types below are the shape the UI expects from oRPC. They are generated from host Zod schemas; the refactor does not hand-write them.

```ts
export type CapabilityEntry = {
  id: string; // e.g. "watchHistory"
  version: string; // e.g. "v1"
  scope: "global" | "user";
};

export type PluginSummary = {
  id: string;
  name: string;
  version: string;
  description: string;
  logoUrl?: string;
  authKind: "form" | "oauth_redirect" | "oauth_device" | "none";
  poolable: boolean;
  // Split for display. Never merged — UI decides where each goes.
  userScopedCapabilities: CapabilityEntry[];
  globalScopedCapabilities: CapabilityEntry[];
  userConfigSchema?: JSONSchema;
  // True iff the admin pool has ≥1 enabled entry. Drives "using server key" copy.
  adminSharedAvailable: boolean;
  // True if the admin has configured plaintext global_config. Informational only.
  hasGlobalConfig: boolean;
  enabled: boolean;
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
  displayFields: Array<{ label: string; value: string; mono?: boolean }>;
  // Full PluginSummary for the plugin this connection belongs to.
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

export type PluginRow = PluginSummary & {
  sourceType: "builtin" | "url";
  isBuiltin: boolean;
  installedAt: number;
  updatedAt: number;
  connectionsCount: number; // user-facing integer
  sharedCredentialsCount: number; // total entries (any enabled state)
  sharedCredentialsEnabledCount: number; // enabled entries
  personalKeyFallback: "off" | "admin-first" | "personal-first";
  globalConfigSchema?: JSONSchema;
  sharedCredentialsSchema?: JSONSchema;
  credentialsSchema?: JSONSchema; // user credentials schema (for reference; FE never edits directly)
};
```

Shapes are consumed by the same oRPC endpoints already in use; the backend PR that implements them will extend the payloads without renaming existing fields. Two fields disappear on the frontend side after the refactor: `hasSharedConfig` (ambiguous; replaced with `adminSharedAvailable` + `hasGlobalConfig`) and `capabilities: string[]` (replaced with the two scoped arrays).

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

Backed by `GET /api/connections/available` which the backend now filters to only plugins that expose at least one user-scoped capability. Pure-global plugins (e.g. a hypothetical TMDB-when-`metadata`-only build) never appear here.

Each available card shows:

- Plugin name (+ optional tiny logo).
- One-line description, truncated.
- **User-scoped capability badges.** Rendered with the same label/icon mapping as today.
- If `plugin.globalScopedCapabilities.length > 0`, a muted one-line footer: `"{cap1}, {cap2} available without a connection"` — capped at three, then "+N more". Conveys that the plugin has value even without the user acting, which is important for mixed plugins like TMDB. Purely cosmetic; no state attached.
- Primary action:
  - If `adminSharedAvailable === true` **and** the plugin has user-scoped capabilities: a muted inline `<KeyIcon /> Using server key` label on the left, with an **`Add your own key`** outline button on the right. Opens the Connection Modal in create mode. Copy: "Unlock your personal {plugin.name} features" when hovered (tooltip).
  - Otherwise: the existing `Connect` primary button.

`hasSharedConfig` in today's code was repurposed sloppily (it currently tracks plaintext `global_config`, not admin shared credentials). The refactor replaces it with `adminSharedAvailable` and deletes the field. The visual affordance is the same; only the source of truth changes.

### Connected instance card

Layout and actions unchanged. Internal changes:

- Remove the `useMemo` that parses `plugin.userConfigSchema` and merges with `connection.userConfig`. Render `connection.displayFields` directly.
- Status badge logic unchanged.
- `Reconnect` flow unchanged: `form` → edit modal; `oauth_*` → create modal with existing connection in edit mode (or a direct reauth if we choose to skip the modal — kept as a modal for consistency with today's code).
- `Remove` dialog copy unchanged.
- Dropdown: remove the legacy "Set as default" visibility rule tied to plugin-id and rely on `plugin.poolable` instead. `Set as default` only appears when `plugin.poolable === true` **and** more than one instance exists. Non-poolable plugins can still carry multiple instances in the DB, but since rotation doesn't apply, the "default" concept is still meaningful — so the condition is simply `plugin.poolable || group.connections.length > 1`. In practice all current plugins either are poolable or have one instance, so the behaviour doesn't regress.

### Empty states

Unchanged copy and layout. Two notes:

- `NoPluginsState` is shown when `plugin.listAvailable` returns zero entries. A server with installed plugins but _all_ pure-global will also trigger this — the copy still makes sense ("no plugins to connect to") because the user genuinely has nothing to act on.
- `EmptyConnectionsState` uses the same `AvailablePluginCard` component so "Connect" / "Add your own key" dual behaviour is inherited.

### Connection modal

Matches today's modal in structure (single dialog, four body variants, device-code panel, edit mode). The refactor adjusts the create/edit flow to respect two new invariants:

- Empty-credentials submissions are rejected by the backend with a typed error (`plugin.credentials_empty`). The modal maps that error to a top-of-form inline message: `"Credentials can't be blank. Enter a {field.title} to continue."`
- For `form` auth in edit mode on a plugin with an `x-secret` field: the "Leave blank to keep current value" placeholder stays; the bespoke secret-preserve logic in `stripEmptySecrets` stays. If the user submits the form with both an unchanged secret and no other changes, the save call short-circuits client-side to only update `displayName`.

Capability badges in the modal header render **both** scoped arrays, but grouped:

- User-scoped badges at normal opacity (what the connection unlocks).
- A muted line below: `"Also provides {list} without a connection"` if `globalScopedCapabilities` is non-empty.

Rationale: mixed plugins like TMDB benefit from being honest in the create flow — the user sees their metadata search is already live and that _adding a key_ unlocks watchlist/ratings.

## `/admin/plugins` page

The page structure — title, subtitle, install button (stub), list-of-cards — stays. The card's information density grows to surface the pool and fallback policy without spawning new pages.

### Plugin card, revised

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 🎬 TMDB  v2.1.0  [Built-in]  [Enabled ✓]                         ⋯ menu │
│ Metadata and ID resolution for movies and TV.                            │
│                                                                          │
│ ◎ Global: [Metadata]  [ID Resolution]                                    │
│ ◎ User:   [Watchlist]  [Ratings]                  Auth: oauth_redirect   │
│                                                                          │
│ Connections: 3  ·  Installed 2026-04-12  ·  Pool: 2/3 ready              │
├──────────────────────────────────────────────────────────────────────────┤
│ Shared credentials (admin-owned pool)              [ + Add credential ]  │
│ ┌──────────────────────────────────────────────────────────────────────┐ │
│ │ Primary key       Enabled  ✓ Ready                     Test  Edit  ⋯│ │
│ │ Backup key        Enabled  ✓ Ready                     Test  Edit  ⋯│ │
│ │ Legacy key        Disabled                             Test  Edit  ⋯│ │
│ │ Rate-limited key  Enabled  ⧗ Retry in 02:14            Test  Edit  ⋯│ │
│ └──────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│ Personal key fallback:  ( off )  ( admin-first )  ( personal-first )     │
│ Admin-owned keys are tried first; users' own keys only kick in when …   │
└──────────────────────────────────────────────────────────────────────────┘
```

Breakdown:

- **Header row.** Name, version, source badge ("Built-in" / "URL"), enabled switch, dropdown menu. Dropdown now contains: `Configure global config` (only when `globalConfigSchema` exists), `Set personal key fallback…` (only for plugins with any user-scoped capability), `Update…` (stub), `Rollback to previous version` (stub, disabled if no prior), `Uninstall` (hidden for built-ins). "Configure shared credentials" is gone; shared credentials are inline.
- **Scope rows.** Two lines of capability badges, one per scope. If a scope array is empty, the whole row is omitted. Rendered with `renderCapabilityBadges`. A tiny ◎ glyph or label (`Global:` / `User:`) carries the distinction; no icon differentiation inside the badge.
- **Meta line.** `Connections: N · Installed …` — same as today. Appends `· Pool: {ready}/{total} ready` when the plugin is `poolable` and has ≥1 shared credential. "Ready" = entries with `enabled && (retryAfter === null || retryAfter <= now)`.
- **Shared credentials section.** Omitted entirely when `sharedCredentialsSchema` is absent. Otherwise a compact table of entries:
  - Label (editable).
  - Enabled toggle inline (right aligns a small `Switch`).
  - Status pill: `Ready`, `Retry in mm:ss`, or `Disabled`.
  - `Test` button (calls `plugin.testSharedCredential`). Result renders inline for 3s, same pattern as the connection card's test button.
  - `Edit` opens a small dialog with the `sharedCredentialsSchema` form.
  - Dropdown: `Rename`, `Delete`.
  - Poolable plugins can hold many entries. Non-poolable plugins (e.g. hypothetical admin-owned single-key variants) show the same table but `+ Add credential` is disabled when one entry already exists — the button's tooltip reads `"This plugin only supports one shared credential."`
  - Empty state inside the section: single muted line `"No shared credentials configured. {Global-scoped, ±User-fallback} capabilities will return CAPABILITY_UNAVAILABLE until one is added."` with a primary `Add credential` button.
- **Personal key fallback row.** Renders only for plugins with at least one user-scoped capability. A segmented control (three buttons) mapped to `"off" | "admin-first" | "personal-first"`. Below the control a one-line muted explainer that swaps based on the current policy:
  - `off`: `"Admin and user keys are kept separate. Global calls use the admin pool; user calls use the user's own keys only."`
  - `admin-first`: `"Admin-owned keys are tried first; users' own keys only kick in when the admin pool is exhausted for that call."`
  - `personal-first`: `"Users' own keys are tried first; admin-owned keys only fill in when the user's pool is exhausted."`
    Changing the value calls `PATCH /api/plugins/:id/personal-key-fallback` (already implemented server-side). Disabled for pure-global plugins with a tooltip: `"Only applies to plugins with user-scoped capabilities."`

### Disabled plugins

Visual treatment unchanged (opacity 60%). All interactive sub-controls (add credential, fallback policy, per-credential test) remain operable — admin may want to fix config before re-enabling.

### Add / Edit shared credential dialog

A shadcn `Dialog`. Title: `"Add shared credential for {plugin.name}"` or `"Edit shared credential"`. Body:

- `Label` text input (required). Placeholder: `"e.g. Primary key"`.
- `Enabled` switch, default `true` on create.
- `SchemaForm` rendering `plugin.sharedCredentialsSchema`. Secret-field handling is identical to the existing user connection flow (masked input, show/hide toggle, "leave blank to keep current value" on edit).
- Footer: `Cancel`, `Test & save` (primary), `Save without test` (outline, smaller).

`Test & save` calls `plugin.testSharedCredential` server-side against the unsaved value. Implementation note: today's server only exposes a test for a stored entry. The refactor adds a backend affordance that accepts an ephemeral value (the alternative — save then test then delete on fail — risks dangling enabled rows during failure). Wire this once the backend endpoint lands; until then `Test & save` falls back to save-then-test with a toast on test failure.

### Configure global config dialog

The existing tabbed dialog is removed. Global config becomes its own single-purpose dialog triggered from the card's dropdown. Body is a `SchemaForm` rendering `plugin.globalConfigSchema`. No credentials tab. No shared credentials blob. Admin always has one save button.

This is a notable simplification: today `ConfigureDialog` in `admin/plugins.tsx` conditionally switches tabs between `config` and `credentials`. That branch goes away; the dialog collapses to the `config`-only path. The `credentials` path is replaced by the inline shared-credentials table described above.

### Install modal (stub)

Kept out of scope for v1 per the existing code comment. The `Install Plugin` button in the header becomes a stub that opens a dialog explaining "Built-in plugins register on boot; URL install will ship in a later version." When the backend install path is wired, the dialog body will grow into the step list from the previous design doc — no structural change required here.

### Uninstall dialog

Unchanged. Typed-name confirmation, destructive copy, cascade warning.

## SchemaForm — minor extensions

The bespoke renderer is kept. Three small extensions land as part of this refactor, driven by the shared-credentials form:

1. **Add-vs-edit mode semantics hold across all call sites.** Today the component already takes `mode`. The shared-credentials create dialog passes `mode="create"` (no "leave blank" placeholder); the edit dialog passes `mode="edit"`.
2. **`stripEmptySecrets`** stays. Shared-credentials edit uses it to preserve untouched secrets, matching the user flow.
3. **Server-error injection.** Already supported via the `serverErrors` prop. The only change is that `connections.ts` procedure errors now come back with `fieldErrors: { [name]: message }` and the modal threads them through to the `SchemaForm`. The current code already passes `serverErrors` but never receives anything non-empty; the contract is honoured once the backend starts returning typed errors for `plugin.credentials_empty`, `plugin.invalid_base_url`, etc.

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

Existing endpoints, existing surface, new fields in response:

- `GET  /api/plugins/` — response rows now include `sharedCredentialsCount`, `sharedCredentialsEnabledCount`, `personalKeyFallback`, `poolable`, and `capabilities: Array<{id,version,scope}>`. (Some of these already land server-side per the diff in `packages/server/src/api/procedures/plugins.ts`.)
- `GET  /api/connections/available` — each plugin gains `userScopedCapabilities`, `globalScopedCapabilities`, `adminSharedAvailable`, `poolable`. `hasSharedConfig` is removed.
- `GET  /api/connections/` — each connection gains `displayFields`. `plugin` sub-object matches `PluginSummary` above.

Existing admin endpoints used by the revised UI:

- `GET    /api/plugins/:id/global-config`
- `PUT    /api/plugins/:id/global-config`
- `GET    /api/plugins/:id/shared-credentials`
- `POST   /api/plugins/:id/shared-credentials`
- `PATCH  /api/plugins/:id/shared-credentials/:credId`
- `DELETE /api/plugins/:id/shared-credentials/:credId`
- `POST   /api/plugins/:id/shared-credentials/:credId/test`
- `PATCH  /api/plugins/:id/personal-key-fallback`

Frontend work wires each of these; none are new.

## File-by-file refactor plan

```
packages/client/src/
├── lib/
│   └── capabilities.ts                    UNCHANGED + add renderCapabilityBadges helper
├── components/connections/
│   ├── schema-form.tsx                    Delete nonSecretFields; no other changes
│   └── connection-modal.tsx               Use scoped capability arrays in header; map
│                                          plugin.credentials_empty to a field error
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

Keep them in the same file unless line count crosses ~800; the existing 647-line file has room.

## Interaction summary

| Action                                                    | Flow                                                                                                                          |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Add connection (form, plugin with `adminSharedAvailable`) | Available card → "Add your own key" → modal → fill → test → save → card appears. Global capabilities keep working throughout. |
| Add connection (form, no admin shared)                    | Available card → "Connect" → modal → fill → test → save → card appears.                                                       |
| Add connection (OAuth redirect)                           | Unchanged.                                                                                                                    |
| Add connection (OAuth device)                             | Unchanged.                                                                                                                    |
| Edit connection                                           | Unchanged.                                                                                                                    |
| Remove connection                                         | Unchanged.                                                                                                                    |
| Reconnect                                                 | Unchanged.                                                                                                                    |
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

- `tanstack-query` optimistic updates are safe for the enabled toggle on both the plugin card and the shared-credential rows. Creates and deletes remain server-authoritative.
- Shared-credential cooldown countdowns are computed from `retryAfter` against a local `now` that ticks every second. A single `useNow(1000)` hook is added to avoid one `setInterval` per row.
- Toasts (shadcn `Toast`/`Sonner`) for: shared credential saved, shared credential deleted, personal-key fallback updated, global config saved. Inline errors stay on the form that produced them.
- When `POST /shared-credentials` fails with `plugin.duplicate_label` or `plugin.not_poolable`, the dialog surfaces the server error inline on the label field or the top of the form respectively.

## Testing

Follows the existing `vp test` harness. Component tests:

- `<SharedCredentialsSection>` renders ready, retry-pending, and disabled states; runs test; opens edit dialog; confirms delete.
- `<PersonalKeyFallbackControl>` renders all three states, calls the mutation, disabled for pure-global plugins.
- `/admin/plugins.tsx` full render given a `PluginRow` with: pure-global plugin, mixed plugin, user-only plugin.
- `<ConnectionModal>` still passes the existing suite plus two new cases: backend returns `plugin.credentials_empty` → inline field error; plugin has `globalScopedCapabilities` → "also provides X" line rendered.
- Connection card renders `displayFields` verbatim; no schema walk.

E2E:

- Admin adds two shared credentials, toggles one off, tests both, deletes one.
- Admin flips personal-key fallback across all three values; explainer copy updates.
- User sees "Using server key" on TMDB, adds a personal key, confirms watchlist capability now appears on the connected card.

## Migration of existing code

This is a single PR. The client and server move together — field renames are breaking. Steps:

1. Land the backend response-shape additions (`displayFields`, scoped capability arrays, `adminSharedAvailable`, `poolable`, `personalKeyFallback`, shared credentials count) in a same-PR server change.
2. Update `connection-modal.tsx` to consume scoped capabilities in the header; add the `plugin.credentials_empty` field-error mapping.
3. Update `connections.tsx`: delete the `useMemo` schema walk, consume `displayFields`, rename `hasSharedConfig` → `adminSharedAvailable`, update section headers to `userScopedCapabilities`, add "also provides" footer on available cards.
4. Rewrite `admin/plugins.tsx`:
   - Remove the tabbed `ConfigureDialog`; keep a global-config-only dialog.
   - Add `<SharedCredentialsSection>` rendering the pool inline.
   - Add `<SharedCredentialDialog>`.
   - Add `<PersonalKeyFallbackControl>`.
   - Replace card-level references to `manifest.allowsSharedCredentials` with `plugin.sharedCredentialsSchema` and `plugin.poolable`.
5. Delete `nonSecretFields` from `schema-form.tsx` and its import site on the connection card.
6. Extend `capabilityDisplay` helper with `renderCapabilityBadges`.

The previous design doc (`2026-04-19-frontend-connections-design.md`) stays in the repo as superseded; this file is the authoritative FE spec going forward.

## Open questions / deferred

- **Test-before-save for shared credentials.** Depends on a backend endpoint that validates an unsaved value. Ship the client with save-then-test fallback and flip once the endpoint is available.
- **Pool telemetry.** Per-entry cooldown is rendered inline; no aggregate charts. Revisit once multi-key rotation is live and telemetry shows skewed distribution.
- **Rollback UI.** The `Rollback to previous version` menu item is stubbed; wire once the backend rollback endpoint lands.
- **Bulk actions** on the admin page (e.g. test all shared credentials, disable all). Not needed in v1.
- **Activity log / audit trail** per connection and per shared credential. Deferred.
- **Logos for plugins.** Same policy as the prior doc: tiny (16-20px) next to the name, never dominant.
