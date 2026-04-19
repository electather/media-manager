# Connections UI — Plugin-Based Frontend Design

**Status:** Draft for review
**Date:** 2026-04-19
**Author:** Omid Astaraki
**Supersedes:** Initial "Design Brief: Connections Page (/connections)"
**Companion:** See `2026-04-19-plugin-architecture-design.md` for the backend spec.

## Summary

The connections UI is being reworked to drive entirely off plugin manifests. The old page hardcoded Trakt, Seerr, TMDB, and TVDB into the layout, modal content, and capability badges. In the plugin model, the frontend knows nothing about specific services. It renders sections, forms, auth flows, and capability badges from data returned by the oRPC layer. This keeps the page honest as plugins are added, removed, or updated, and removes the need to ship a frontend change every time a new integration lands.

This document covers two surfaces:

- `/connections` — user-facing, manages the authenticated user's connections.
- `/admin/plugins` — admin-only, manages installed plugins and their global config.

## Goals

- Zero plugin-specific code on the frontend. Service names, icons, forms, and auth flows all come from the manifest.
- Preserve the visual language of the existing dashboard: shadcn/ui, clean minimalism, spacious layout, typography-driven hierarchy.
- Support three auth ceremonies (form, OAuth redirect, OAuth device code) with a single unified modal.
- Scale past the original ~8 card assumption without becoming noisy.
- Provide a small, bespoke JSON Schema form renderer that matches the design system (no generic library).

## Non-goals

- Plugin marketplace or discovery UI. Admins install by URL.
- In-browser plugin editing or debugging.
- Auto-update prompts. Manual update only in v1.
- Multi-language support for plugin-provided strings. Plugins declare labels in English; i18n is a future concern.

## Stack

- Next.js App Router, React, TypeScript.
- shadcn/ui component library (existing).
- oRPC client with tanstack-query.
- Icons: `lucide-react` (consistent with shadcn conventions).
- Form renderer: custom, ~200 lines, documented in this spec.

Dashboard shell (sidebar nav, header, theme toggle) already exists. This design covers page content only.

## Core data model on the frontend

All pages consume a small set of derived types from the oRPC API. Types are generated from host Zod schemas.

```ts
type PluginSummary = {
  id: string;
  name: string;
  version: string;
  description: string;
  logoUrl?: string;
  authKind: "form" | "oauth_redirect" | "oauth_device" | "none";
  capabilities: string[]; // capability ids, e.g. ["watchHistory", "watchlist"]
  userConfigSchema?: JSONSchema;
  hasSharedConfig: boolean; // true if plugin has global_config set by admin
  enabled: boolean; // globally enabled by admin
};

type ConnectionSummary = {
  id: string;
  pluginId: string;
  displayName?: string;
  status: "connected" | "expired" | "error" | "disconnected";
  enabled: boolean;
  isDefault: boolean;
  lastVerifiedAt?: number;
  errorMessage?: string;
  // Plugin-agnostic fields derived from userConfigSchema for display:
  // e.g. Seerr's base_url shown on the card. The backend returns a short
  // `displayFields: Array<{ label: string; value: string; mono?: boolean }>`
  // computed from userConfigSchema + decrypted user_config, omitting any
  // fields marked `"x-secret": true`.
  displayFields: Array<{ label: string; value: string; mono?: boolean }>;
};
```

`displayFields` is a key piece. The frontend never decrypts config or knows which fields are sensitive. The backend walks `userConfigSchema`, excludes any field with `"x-secret": true`, and returns only what's safe to show. Seerr shows its URL; plugins with no non-secret user config show nothing.

## Capability display map

Host-maintained, lives on the frontend in `lib/capabilities.ts`:

```ts
export const CAPABILITY_DISPLAY: Record<string, { label: string; icon: LucideIcon }> = {
  watchHistory: { label: "Watch History", icon: HistoryIcon },
  watchlist: { label: "Watchlist", icon: BookmarkIcon },
  ratings: { label: "Ratings", icon: StarIcon },
  recommendations: { label: "Recommendations", icon: SparklesIcon },
  calendar: { label: "Calendar", icon: CalendarIcon },
  metadata: { label: "Metadata", icon: InfoIcon },
  mediaRequest: { label: "Media Requests", icon: DownloadIcon },
  idResolve: { label: "ID Resolution", icon: LinkIcon },
};

export function capabilityDisplay(id: string) {
  return CAPABILITY_DISPLAY[id] ?? { label: titleize(id), icon: PlugIcon };
}
```

Unknown capabilities (from a plugin declaring a capability before the host adds a display mapping) fall back to `titleize(id)` and a generic icon. Page never breaks.

## `/connections` page structure

### Page header

- Title: "Connections"
- Subtitle (muted): "Connect your media services to enable tracking, requesting, and personalized recommendations through your AI assistant."
- For admin users only: a small `Manage Plugins →` link aligned to the right, navigating to `/admin/plugins`. No other admin UI bleeds into this page.

### Alert banner (conditional)

Rendered above the connection list when any of the user's connections have `status` of `error` or `expired`. Uses shadcn `Alert` with `variant="destructive"` for errors, `variant="warning"` for expired.

Copy:

- Error: `{n} connection{s} need attention. Click a card below to fix.`
- Expired (no errors): `{n} connection{s} need re-authentication.`

Only rendered when something is actually broken. The old doc's requirement stands: the user should never have to hunt across cards to discover something is off.

### Layout — hybrid grid

The page shows two blocks vertically:

1. **Your Connections** — one section per plugin the user has a connection for.
2. **Available to Connect** — compact grid of enabled plugins the user has no connection for (collapsible).

This replaces the old "all sections always visible" approach. Connected things get full real estate; unconnected things are browse-able but do not dominate the page once you install a dozen plugins.

#### Your Connections

Section order: by `plugin.name` alphabetically, except any plugin with error/expired connections floats to the top. Each section has:

- **Section heading row:**
  - Plugin name (h3, left).
  - Capability badges inline (right of name, wrapping on narrow viewports): one subtle shadcn `Badge variant="secondary"` per capability, using `capabilityDisplay(id).label`. Icons rendered before labels at a subdued opacity.
- **Connection cards** (one per instance).
- **Add another instance** ghost card at the end of the section, matching the old design's "+ Add {service} connection" pattern.

#### Available to Connect

Single section at the bottom with a muted heading `"Available to Connect"` and a collapsible chevron (defaults to expanded on first visit, collapsed state persists in localStorage).

Each card in this section is compact:

- Plugin name (primary text).
- One-line description (muted, truncated).
- Capability badges (smaller, same visual language as the connected sections).
- For TMDB/TVDB-style plugins with `hasSharedConfig: true`: a muted inline note "Using server's shared key" plus a `Add your own key` link that opens the add modal. For these, the card doesn't render the usual "Connect" button; the shared-key state is the current state, and adding a personal key is a secondary path.
- Otherwise: a primary `Connect` button.

Layout: responsive grid, 3 columns at `lg`, 2 at `md`, 1 at `sm`.

### Connected instance card

Matches the old doc closely, with field sources swapped to be plugin-agnostic:

**Card header:**

- `displayName` (primary text) or plugin name if unset.
- Status badge — `Connected` (green), `Expired` (yellow), `Error` (red), `Disabled` (muted secondary).
- If multiple instances of this plugin exist: a small outline "Default" badge on the default instance only.

**Card body:**

- `lastVerifiedAt` relative timestamp, muted.
- If status is `error` or `expired`: `errorMessage` in muted destructive text.
- `displayFields` rendered as a small definition list (label + value). Monospace-rendered fields (URLs, IPs) use `font-mono`. For plugins with no display fields (e.g. TMDB's API key is secret), this section is omitted.

**Card actions:**

Primary and secondary actions follow the old doc:

- Promoted `Reconnect` button when status is `error` or `expired`. Behavior branches on `authKind`:
  - `oauth_redirect` or `oauth_device`: re-runs the auth flow.
  - `form`: opens the edit modal.
- Dropdown menu for the rest: Test, Set as default, Disable/Enable, Edit, Remove.

`Set as default` appears only when another instance of the same plugin exists. `Disable` / `Enable` toggles without removal; disabled cards have `opacity-50` and a muted background. `Remove` opens a shadcn `AlertDialog` with the old doc's copy: `"This will remove your {plugin} connection '{display name}'. Your data on {plugin} is not affected."`.

Test result is rendered inline on the card (checkmark + "Verified" or a short error message), auto-dismissing after ~3 seconds.

### Empty state

When the user has zero connections across all plugins, replace the two-block layout with a centered empty state:

- Heading: "No services connected"
- Muted copy: "Connect your media services to start tracking what you watch, requesting downloads, and getting personalized recommendations."
- Below: a compact grid of all enabled plugins (same card shape as "Available to Connect"), serving as the entry point.

If no plugins are installed at all (fresh server), the empty state copy changes:

- "No plugins installed yet."
- Muted: "Ask your administrator to install plugins to connect external services."
- For admins: a primary button `Manage Plugins →` linking to `/admin/plugins`.

## The connection modal

One modal component drives all three auth ceremonies. It reads the plugin's `authKind` and `userConfigSchema` and renders the right surface.

```tsx
<ConnectionModal plugin={plugin} connectionId={null | existingId} mode="create" | "edit" />
```

The modal is a shadcn `Dialog`. Title: `"Add {plugin.name} Connection"` or `"Edit {plugin.name} Connection"`. Close button top-right. Footer actions vary by step.

### Shared header area

Every variant includes:

- Plugin name, version (muted small), and one-line description at the top.
- A `Display name` text field (optional, placeholder suggests plugin name or instance-appropriate default).

### Body by auth kind

**`authKind: "form"`** (e.g. Seerr):

- Renders `userConfigSchema` through the schema form renderer (see next section).
- `Test connection` button below the form.
- Before test passes, `Save` is disabled. After test passes, `Save` is enabled and the button shows a success badge next to the test button.
- On test fail, error message rendered between form and buttons in muted destructive text.

**`authKind: "oauth_redirect"`**:

- Body is a short explainer block and a single primary `Connect with {plugin.name}` button.
- Clicking the button calls `connection.initiateOAuth`, receives `{ redirectUrl, nonce }`, and performs `window.location.assign(redirectUrl)`.
- Nonce is held in the current route so the callback page can find and complete the flow.

**`authKind: "oauth_device"`** (e.g. Trakt):

- Same explainer block.
- Primary `Connect with {plugin.name}` button calls `connection.initiateDeviceAuth`, receives `{ userCode, verifyUrl, nonce, intervalSec, expiresAt }`.
- Modal body swaps to a device-code display panel:
  - Large mono text rendering of `userCode` with a Copy button.
  - "Go to `<verifyUrl>`" as a clickable link that opens in a new tab.
  - A small progress indicator showing remaining time (countdown to `expiresAt`).
  - Status text ("Waiting for you to approve on {plugin.name}…").
- Frontend polls `connection.pollDeviceAuth(nonce)` every `intervalSec`. On `completed`, modal closes and the new card is shown. On `error` or expiry, modal shows the error with a `Try again` button.
- While polling, the modal stays open. Cancel aborts polling and closes the modal; the `pending_auth` row expires server-side on its own TTL.

**`authKind: "none"`**:

- The modal exists only for plugins that need `userConfig` even without auth (rare). If neither auth nor user config is required, `Add Connection` on the plugin's card directly creates a connection without opening the modal.

### Edit mode

`connection.getUserConfig` is called on open to pre-fill non-secret fields. Secret fields (any field marked `"x-secret": true`) are always shown empty with a placeholder "Leave blank to keep current value". On save, empty secret fields are omitted from the submission and the backend preserves the existing encrypted value.

For OAuth plugins, edit mode only lets the user change `displayName`. Credentials are not editable from the UI; the user can `Reconnect` to re-run the auth flow instead.

### Reconnect (OAuth, status = expired or error)

Not a modal — a direct action on the card that runs the same flow as the create modal's auth step without the form header. For `oauth_device`, the device-code panel renders as a small inline dialog anchored to the card.

## JSON Schema form renderer

A small, bespoke renderer (~200 lines) in `components/connections/schema-form.tsx`. Walks a JSON Schema object and maps field types to shadcn components. Built for the shapes plugins actually need, not generality.

### Supported field types

| JSON Schema                                   | Rendered component                                                   |
| --------------------------------------------- | -------------------------------------------------------------------- |
| `{ type: "string" }`                          | shadcn `Input`                                                       |
| `{ type: "string", format: "uri" }`           | `Input type="url"` with URL validation                               |
| `{ type: "string", "x-secret": true }`        | `Input type="password"` with show/hide toggle (`Eye`/`EyeOff` icons) |
| `{ type: "string", format: "textarea" }`      | shadcn `Textarea`                                                    |
| `{ type: "string", enum: [...] }`             | shadcn `Select`                                                      |
| `{ type: "number" }` or `{ type: "integer" }` | `Input type="number"` with min/max/step respected                    |
| `{ type: "boolean" }`                         | shadcn `Switch` with inline label                                    |

`title` is used as the field label. `description` as the muted helper text below. `default` pre-fills the value. `required` marks the field (indicator + client-side required check).

### Validation

Client-side: simple structural validation inline using `ajv`. Covers required fields, enum membership, `format: "uri"`, min/max on numbers. Errors render under the field in muted destructive text. No arbitrary JSON Schema keywords beyond the above.

Server-side: the real source of truth. The backend validates on every create/update against the plugin's schema via `ajv` and returns field-keyed errors in a standard shape that the renderer can attach to the right fields.

### What it does NOT support

- `oneOf` / `anyOf` / `allOf` composition.
- Object and array field types.
- `$ref` resolution.
- Custom widgets beyond the table above.

If a plugin author needs something outside this surface, they refactor their config. The SDK docs state the supported surface explicitly.

### Plugin-author conventions

Documented in the SDK reference:

- Mark secret fields with `"x-secret": true`. Frontend masks and excludes from display.
- Use `format: "uri"` for URLs. Frontend validates and monospace-renders in cards.
- Keep schemas flat. No nesting.
- Provide `title` and `description` on every field. They are user-facing copy.

## `/admin/plugins` — admin UI

Lives under the existing admin area. Only users with `admin:plugins` permission can reach it.

### Page structure

- Title: "Plugins"
- Subtitle (muted): "Manage plugins that provide external service integrations."
- Primary action button top-right: `Install Plugin`.

### Installed plugins table

Rendered as a vertical list of cards (same visual weight as connection cards, for consistency). Each card shows:

- Plugin name, version, and source badge ("Built-in" / "URL").
- Description.
- Capability badges.
- Global enable/disable switch (toggles `plugins.enabled`).
- `Connections: {n}` muted stat (number of user connections for this plugin).
- Dropdown actions: `Configure` (opens global config modal, enabled only for plugins with a `globalConfigSchema`), `Update` (prompts for new source URL), `Rollback to previous version` (disabled if no prior version on disk), `Uninstall`.

Disabled plugins are visually muted like disabled user connections. Built-in plugins cannot be uninstalled; the `Uninstall` item is hidden.

### Install modal

- Source URL field (required, `format: "uri"` validation).
- Expected checksum field (optional, `sha256`).
- On submit, calls `plugin.install`. While the call runs, modal shows a progress step list matching the backend's install flow:
  - Fetching plugin source…
  - Verifying checksum…
  - Loading manifest…
  - Validating capabilities…
  - Installing…
- On success, modal closes and the new plugin card appears.
- On failure, the specific step shows a red X with the error message. No partial state.

### Global config modal

For plugins with a `globalConfigSchema`, a modal uses the same schema form renderer (the one built for user connections) to edit the admin-level config. Save writes via `plugin.setGlobalConfig`. Secret fields follow the same "leave blank to keep current value" rule as user connections.

For TMDB/TVDB, this is where the admin sets the shared API key.

### Uninstall confirmation

Shadcn `AlertDialog`. Copy warns about the blast radius: "This will remove the {plugin.name} plugin and delete all {n} user connections to it. User data on the external service is not affected."

Requires typing the plugin name to confirm (standard dangerous-action pattern).

## Interaction summary

| Action                          | Flow                                                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Add connection (form)           | Available card → modal → fill → test → save → card appears in Your Connections                            |
| Add connection (OAuth redirect) | Available card → modal → Connect → redirect → callback → card appears                                     |
| Add connection (OAuth device)   | Available card → modal → Connect → device code panel → approve externally → poll completes → card appears |
| Edit connection                 | Card dropdown "Edit" → modal pre-filled (non-secret fields) → modify → save                               |
| Remove connection               | Card dropdown "Remove" → AlertDialog → confirm → card removed                                             |
| Reconnect (OAuth expired/error) | Prominent card button → direct auth flow (no modal)                                                       |
| Reconnect (form error)          | Prominent card button → edit modal → fix → test → save                                                    |
| Test connection                 | Card dropdown → inline spinner → result (auto-dismiss 3s)                                                 |
| Set as default                  | Card dropdown → immediate swap, previous default loses badge                                              |
| Disable/enable                  | Card dropdown → card visual state changes                                                                 |
| Admin install plugin            | Install button → modal → progress → card appears                                                          |
| Admin set global config         | Plugin card dropdown "Configure" → modal → save                                                           |
| Admin uninstall                 | Plugin card dropdown "Uninstall" → AlertDialog with typed confirmation → cascade                          |

## Responsive layout

- **`lg` and up:** two-column card grid within each connected section; three-column grid for "Available to Connect".
- **`md`:** single-column cards in connected sections; two-column "Available to Connect".
- **`sm`:** everything stacks. Connection cards show the dropdown menu instead of inline actions. Modal becomes full-screen on mobile (shadcn's default behavior is fine).
- Capability badges wrap gracefully; on narrow viewports, the badge row moves below the plugin name rather than inline.

## Accessibility

- All interactive components from shadcn already meet AA contrast and keyboard navigation.
- OAuth device code panel: `userCode` has `aria-label="Device code: {code}"`. The verify URL link uses `rel="noopener"`.
- Status badges include a visually-hidden text label for screen readers ("Status: Error").
- Form validation errors are associated to their fields with `aria-describedby`.
- Modal traps focus, returns focus to the triggering element on close.

## States and feedback

- **Loading the page:** skeleton cards in each section, matching the final card shape.
- **Refetching after a mutation:** tanstack-query optimistic updates where safe (status toggles, display name edits). Server-authoritative updates for creates, deletes, and auth flows.
- **Mutation in flight:** disabled buttons with spinners; modal cannot be closed during an auth call.
- **Toast notifications** for non-critical success/failure (shadcn `Toast` or `Sonner`). Critical failures (auth expired mid-session) render inline on the affected card.

## Testing

- Component tests for the schema form renderer: each supported field type, validation behavior, secret-field masking, and edit-mode empty placeholders.
- Component tests for the connection modal across all four auth kinds, including device-code polling.
- E2E tests: create connection (one per auth kind), edit, test, disable, set default, remove.
- Admin E2E: install plugin, set global config, uninstall with cascade confirmation.
- Visual regression on the Available to Connect grid at 0, 5, and 20 available plugins.

## Open questions / deferred

- **Plugin icons.** Old doc said no large logos, text name primary. Kept here. If a plugin ships `logoUrl`, render it small (16-20px) next to the name for scannability; never dominant.
- **Search within Available to Connect.** Not needed at v1. Revisit if plugin counts exceed ~30.
- **Bulk actions.** No "disable all" or "test all" in v1.
- **Activity log per connection** (history of auth events, test results). Deferred to a later feature.
