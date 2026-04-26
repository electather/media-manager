# Connections UI — Plugin-Based Frontend Design

**Status:** Draft for review
**Date:** 2026-04-19
**Author:** Omid Astaraki
**Supersedes:** Initial "Design Brief: Connections Page (/connections)"
**Companion:** §`2026-04-19-plugin-architecture-design.md` — backend spec.

> **Superseded & route relocated.** Superseded by `2026-04-22-frontend-plugin-connections-design.md`. As of 2026-04-24 page lives at `/settings/connections` — top-level `/connections` removed. See `docs/2026-04-24-user-settings-design.md` for relocation rationale.

## Summary

Connections UI rework: fully manifest-driven. Old page hardcoded Trakt, Seerr, TMDB, TVDB. New model: frontend knows ⊥ specific services. Renders sections, forms, auth flows, capability badges from RPC layer data. Page stays honest as plugins added/removed/updated. ⊥ frontend change when new integration lands.

Two surfaces:

- `/connections` — user-facing, manages authenticated user's connections.
- `/admin/plugins` — admin-only, manages installed plugins & global config.

## Goals

- V1: ∀ plugin-specific code on frontend ⊥. Names, icons, forms, auth flows from manifest.
- Preserve existing dashboard visual language: shadcn/ui, clean minimalism, spacious layout, typography-driven hierarchy.
- Support 3 auth ceremonies (form, OAuth redirect, OAuth device) via single unified modal.
- Scale past ~8 card assumption without noise.
- Small bespoke JSON Schema form renderer matching design system (⊥ generic library).

## Non-goals

- Plugin marketplace or discovery UI. Admins install by URL.
- In-browser plugin editing or debugging.
- Auto-update prompts. Manual update only v1.
- Multi-language for plugin-provided strings. English only; i18n future.

## Stack

- Next.js App Router, React, TypeScript.
- shadcn/ui (existing).
- RPC client + tanstack-query.
- Icons: `lucide-react`.
- Form renderer: custom, ~200 lines.

Dashboard shell (sidebar nav, header, theme toggle) exists. Design covers page content only.

## Core data model

All pages consume derived types from RPC API. Types generated from host Zod schemas.

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

`displayFields`: frontend ⊥ decrypts config or knows secret fields. Backend walks `userConfigSchema`, excludes `"x-secret": true` fields, returns safe subset. Seerr shows URL; plugins with ⊥ non-secret user config show nothing.

## Capability display map

Host-maintained, lives at `lib/capabilities.ts`:

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

Unknown capabilities → `titleize(id)` + generic icon. Page ⊥ breaks.

## `/connections` page structure

### Page header

- Title: "Connections"
- Subtitle (muted): "Connect your media services to enable tracking, requesting, and personalized recommendations through your AI assistant."
- Admin only: small `Manage Plugins →` link aligned right → `/admin/plugins`. ⊥ other admin UI bleeds into page.

### Alert banner (conditional)

Rendered above connection list when ∃ connection with `status` `error` | `expired`. Uses shadcn `Alert`:

- `variant="destructive"` for errors, `variant="warning"` for expired.

Copy:

- Error: `{n} connection{s} need attention. Click a card below to fix.`
- Expired (no errors): `{n} connection{s} need re-authentication.`

Rendered only when broken. User ⊥ hunt across cards to discover issues.

### Layout — hybrid grid

Two vertical blocks:

1. **Your Connections** — one section per plugin user has connection for.
2. **Available to Connect** — compact grid of enabled plugins user has ⊥ connection for (collapsible).

Connected things get full real estate; unconnected browse-able but ⊥ dominant.

#### Your Connections

Section order: `plugin.name` alphabetical, except plugins with error/expired connections float top. Each section:

- **Section heading row:** Plugin name (h3, left) | capability badges inline (right of name, wrapping narrow): one shadcn `Badge variant="secondary"` per capability, using `capabilityDisplay(id).label`. Icons before labels at subdued opacity.
- **Connection cards** (one per instance).
- **Add another instance** ghost card at section end.

#### Available to Connect

Section bottom, muted heading `"Available to Connect"` + collapsible chevron (defaults expanded first visit, localStorage persists).

Each card:

- Plugin name (primary).
- One-line description (muted, truncated).
- Capability badges (smaller, same visual language).
- `hasSharedConfig: true` (TMDB/TVDB-style): muted inline note "Using server's shared key" + `Add your own key` link → add modal. ⊥ "Connect" button; shared-key = current state, personal key = secondary path.
- Otherwise: primary `Connect` button.

Layout: responsive grid, 3 cols `lg`, 2 `md`, 1 `sm`.

### Connected instance card

**Card header:**

- `displayName` (primary) or plugin name if unset.
- Status badge — `Connected` (green), `Expired` (yellow), `Error` (red), `Disabled` (muted secondary).
- Multiple instances: small outline "Default" badge on default instance only.

**Card body:**

- `lastVerifiedAt` relative timestamp, muted.
- `status` = `error` | `expired`: `errorMessage` in muted destructive text.
- `displayFields` as small definition list (label + value). Mono-rendered fields (URLs, IPs) use `font-mono`. Plugins with ⊥ display fields → section omitted.

**Card actions:**

- Promoted `Reconnect` button when `status` = `error` | `expired`. Branches on `authKind`:
  - `oauth_redirect` | `oauth_device`: re-runs auth flow.
  - `form`: opens edit modal.
- Dropdown: Test, Set as default, Disable/Enable, Edit, Remove.

`Set as default` appears only when ∃ another instance of same plugin. `Disable`/`Enable` toggles ⊥ removal; disabled cards `opacity-50` + muted background. `Remove` → shadcn `AlertDialog`: `"This will remove your {plugin} connection '{display name}'. Your data on {plugin} is not affected."`.

Test result: inline on card (checkmark + "Verified" | short error), auto-dismisses ~3s.

### Empty state

Zero connections → centered empty state:

- Heading: "No services connected"
- Muted: "Connect your media services to start tracking what you watch, requesting downloads, and getting personalized recommendations."
- Below: compact grid of all enabled plugins (same card shape as "Available to Connect").

⊥ plugins installed (fresh server):

- "No plugins installed yet."
- Muted: "Ask your administrator to install plugins to connect external services."
- Admins: primary `Manage Plugins →` → `/admin/plugins`.

## Connection modal

One modal drives all 3 auth ceremonies. Reads `authKind` + `userConfigSchema`, renders right surface.

```tsx
<ConnectionModal plugin={plugin} connectionId={null | existingId} mode="create" | "edit" />
```

shadcn `Dialog`. Title: `"Add {plugin.name} Connection"` | `"Edit {plugin.name} Connection"`. Close button top-right. Footer actions vary by step.

### Shared header

∀ variants:

- Plugin name, version (muted small), one-line description.
- `Display name` text field (optional, placeholder suggests plugin name | instance-appropriate default).

### Body by auth kind

**`authKind: "form"`** (e.g. Seerr):

- Renders `userConfigSchema` through schema form renderer.
- `Test connection` button below form.
- Before test passes: `Save` disabled. After: `Save` enabled + success badge next to test button.
- Test fail: error in muted destructive text between form and buttons.

**`authKind: "oauth_redirect"`**:

- Short explainer + single primary `Connect with {plugin.name}` button.
- Button → `connection.initiateOAuth` → `{ redirectUrl, nonce }` → `window.location.assign(redirectUrl)`.
- Nonce held in current route so callback page can complete flow.

**`authKind: "oauth_device"`** (e.g. Trakt):

- Same explainer.
- `Connect with {plugin.name}` → `connection.initiateDeviceAuth` → `{ userCode, verifyUrl, nonce, intervalSec, expiresAt }`.
- Modal body swaps to device-code panel:
  - Large mono `userCode` + Copy button.
  - "Go to `<verifyUrl>`" clickable link (new tab).
  - Progress indicator showing remaining time (countdown to `expiresAt`).
  - Status: "Waiting for you to approve on {plugin.name}…"
- Frontend polls `connection.pollDeviceAuth(nonce)` every `intervalSec`. `completed` → modal closes, card shown. `error` | expiry → error + `Try again` button.
- Modal stays open while polling. Cancel aborts polling + closes modal; `pending_auth` row expires server-side via TTL.

**`authKind: "none"`**:

- Modal exists only for plugins needing `userConfig` ⊥ auth (rare). If ⊥ auth & ⊥ user config → `Add Connection` on card creates connection directly, ⊥ modal.

### Edit mode

`connection.getUserConfig` called on open to pre-fill non-secret fields. Secret fields (`"x-secret": true`) always shown empty, placeholder "Leave blank to keep current value". On save, empty secret fields omitted; backend preserves existing encrypted value.

OAuth plugins: edit mode allows `displayName` change only. Credentials ⊥ editable from UI; user `Reconnect` to re-run auth flow.

### Reconnect (OAuth, status = expired | error)

⊥ modal — direct action on card runs same flow as create modal auth step ⊥ form header. `oauth_device`: device-code panel renders as small inline dialog anchored to card.

## JSON Schema form renderer

Small bespoke renderer (~200 lines) at `components/connections/schema-form.tsx`. Walks JSON Schema object, maps field types to shadcn components. Built for plugin-needed shapes, ⊥ generality.

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

`title` → field label. `description` → muted helper text. `default` → pre-fills value. `required` → indicator + client-side required check.

### Validation

Client-side: structural via `ajv`. Covers required, enum membership, `format: "uri"`, min/max on numbers. Errors under field in muted destructive text. ⊥ arbitrary JSON Schema keywords beyond table above.

Server-side: source of truth. Backend validates ∀ create/update against plugin schema via `ajv`, returns field-keyed errors in standard shape renderer attaches to right fields.

### What renderer does NOT support

- `oneOf` / `anyOf` / `allOf` composition.
- Object & array field types.
- `$ref` resolution.
- Custom widgets beyond table above.

Plugin authors needing outside this surface ! refactor config. SDK docs state supported surface explicitly.

### Plugin-author conventions

Documented in SDK reference:

- Mark secret fields `"x-secret": true`. Frontend masks, excludes from display.
- Use `format: "uri"` for URLs. Frontend validates, mono-renders in cards.
- Keep schemas flat. ⊥ nesting.
- Provide `title` + `description` on ∀ field. User-facing copy.

## `/admin/plugins` — admin UI

Under existing admin area. `admin:plugins` permission !.

### Page structure

- Title: "Plugins"
- Subtitle (muted): "Manage plugins that provide external service integrations."
- Primary action top-right: `Install Plugin`.

### Installed plugins

Vertical list of cards (same visual weight as connection cards). Each card:

- Plugin name, version, source badge ("Built-in" | "URL").
- Description.
- Capability badges.
- Global enable/disable switch (toggles `plugins.enabled`).
- `Connections: {n}` muted stat.
- Dropdown: `Configure` (opens global config modal, enabled only for plugins with `globalConfigSchema`), `Update` (prompts new source URL), `Rollback to previous version` (disabled if ⊥ prior version on disk), `Uninstall`.

Disabled plugins visually muted. Built-in plugins: `Uninstall` hidden (⊥ uninstall).

### Install modal

- Source URL field (!, `format: "uri"` validation).
- Checksum field (?, `sha256`).
- Submit → `plugin.install`. Progress step list while running:
  - Fetching plugin source…
  - Verifying checksum…
  - Loading manifest…
  - Validating capabilities…
  - Installing…
- Success → modal closes, new plugin card appears.
- Failure → specific step shows red X + error. ⊥ partial state.

### Global config modal

Plugins with `globalConfigSchema` → modal uses same schema form renderer as user connections. Save → `plugin.setGlobalConfig`. Secret fields: same "leave blank to keep current value" rule.

For TMDB/TVDB: admin sets shared API key here.

### Uninstall confirmation

shadcn `AlertDialog`. Copy: "This will remove the {plugin.name} plugin and delete all {n} user connections to it. User data on the external service is not affected."

! type plugin name to confirm.

## Interaction summary

| Action                          | Flow                                                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Add connection (form)           | Available card → modal → fill → test → save → card appears in Your Connections                            |
| Add connection (OAuth redirect) | Available card → modal → Connect → redirect → callback → card appears                                     |
| Add connection (OAuth device)   | Available card → modal → Connect → device code panel → approve externally → poll completes → card appears |
| Edit connection                 | Card dropdown "Edit" → modal pre-filled (non-secret fields) → modify → save                               |
| Remove connection               | Card dropdown "Remove" → AlertDialog → confirm → card removed                                             |
| Reconnect (OAuth expired/error) | Prominent card button → direct auth flow (⊥ modal)                                                        |
| Reconnect (form error)          | Prominent card button → edit modal → fix → test → save                                                    |
| Test connection                 | Card dropdown → inline spinner → result (auto-dismiss 3s)                                                 |
| Set as default                  | Card dropdown → immediate swap, previous default loses badge                                              |
| Disable/enable                  | Card dropdown → card visual state changes                                                                 |
| Admin install plugin            | Install button → modal → progress → card appears                                                          |
| Admin set global config         | Plugin card dropdown "Configure" → modal → save                                                           |
| Admin uninstall                 | Plugin card dropdown "Uninstall" → AlertDialog with typed confirmation → cascade                          |

## Responsive layout

- `lg`+: 2-col card grid per connected section; 3-col "Available to Connect".
- `md`: 1-col connected sections; 2-col "Available to Connect".
- `sm`: ∀ stacks. Connection cards show dropdown ⊥ inline actions. Modal full-screen (shadcn default).
- Capability badges wrap; narrow → badge row moves below plugin name.

## Accessibility

- ∀ interactive shadcn components meet AA contrast + keyboard navigation.
- OAuth device code panel: `userCode` has `aria-label="Device code: {code}"`. Verify URL link uses `rel="noopener"`.
- Status badges: visually-hidden text for screen readers ("Status: Error").
- Form validation errors associated to fields via `aria-describedby`.
- Modal traps focus, returns focus to triggering element on close.

## States and feedback

- **Page loading:** skeleton cards per section, matching final card shape.
- **Refetch after mutation:** tanstack-query optimistic updates where safe (status toggles, display name edits). Server-authoritative for creates, deletes, auth flows.
- **Mutation in flight:** disabled buttons + spinners; modal ⊥ closeable during auth call.
- **Toast notifications** for non-critical success/failure (shadcn `Toast` | `Sonner`). Critical failures (auth expired mid-session) render inline on affected card.

## Testing

- Component tests for schema form renderer: ∀ supported field types, validation, secret-field masking, edit-mode empty placeholders.
- Component tests for connection modal across 4 auth kinds, including device-code polling.
- E2E: create connection (one per auth kind), edit, test, disable, set default, remove.
- Admin E2E: install plugin, set global config, uninstall with cascade confirmation.
- Visual regression on Available to Connect grid at 0, 5, 20 plugins.

## Open questions / deferred

- **Plugin icons.** ⊥ large logos; text name primary. `logoUrl` → render small (16-20px) next to name; ⊥ dominant.
- **Search within Available to Connect.** ⊥ needed v1. Revisit if plugin count > ~30.
- **Bulk actions.** ⊥ "disable all" / "test all" v1.
- **Activity log per connection** (auth events, test results history). Deferred.
