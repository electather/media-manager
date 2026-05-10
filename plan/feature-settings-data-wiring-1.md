---
goal: Wire all 6 settings tabs to live data; delete settings mocks
version: 1.1
date_created: 2026-05-10
last_updated: 2026-05-10
owner: Omid Astaraki
status: 'Planned'
tags: [feature, frontend, wiring, settings]
---

> **v1.1 — review remediation 2026-05-10.** Agent review found 14 valid issues (2 BLOCKER, 12 MAJOR/MINOR). Hot fixes applied below: `APP_EXTERNAL_URL` env var; drop client-side `ConnectionStatus` mapper (server already classifies); SQL `CASE` fixed via `MIN()` over `oauthConsent.createdAt`; revoke endpoint body shape clarified (`{ ok, apps }`); `ReauthDialog` deletion preserves shared password message keys; `'new'` filter pill added; ghost `Rename`/`View activity` actions removed; full message-key removal enumerated; inbox treated as real `service_connections` row (not virtual prepend); shared package built before server; test infra helper added; phase commits no longer required to keep `vp check` green mid-PR.

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

Replace mock-driven `/settings` UI with live data. Six tabs (`profile`, `security`, `connections`, `apps`, `notifications`, `danger`) consume real data via `authClient`, `api.me.*`, `api.config.public`, `api.connections.*`, `api.notifications.*`. Single PR. Visual redesign already merged. Server side already documented per `docs/2026-04-24-user-settings-design.md` (amended 2026-05-10) and `docs/2026-05-06-notifications-client-design.md` (amended 2026-05-10). Three small server widenings needed: extend `PublicConfig`, extend `AuthorizedApp`, move `MCP_SCOPES` const into shared package. Delete `apps/client/src/features/settings/mocks.ts` after sweep.

## 1. Requirements & Constraints

- **REQ-001**: Every consumer of `apps/client/src/features/settings/mocks.ts` switches to live data; file deleted at end of sweep.
- **REQ-002**: All six tabs render with real data on first paint via `useSuspenseQuery` (or `authClient.useSession`/`useQuery` where Better Auth requires it).
- **REQ-003**: `api.config.public.$get()` returns `{ emailEnabled: boolean; mcpEndpointUrl: string; mcpScopes: readonly string[] }`. Cached `staleTime: Infinity`.
- **REQ-004**: `api.me.apps.$get()` returns `AuthorizedApp` array with `status: 'active' | 'idle' | 'new'` derived in SQL `CASE` over `lastUsedAt`/`connectedAt` plus `description: string | null`.
- **REQ-005**: `MCP_SCOPES` const moves from `apps/server/src/mcp/scopes.ts` to `packages/shared/src/users/`; server re-imports from shared.
- **REQ-006**: `/settings/connections` reuses `ConnectionModal` from `apps/client/src/features/connections/` for add/edit/test/oauth flows.
- **REQ-007**: `/settings/notifications` reuses `ConnectionModal` for edit; inbox row identified by `pluginId === "inbox"` and rendered as locked (no test/edit/delete actions). Inbox is a real `service_connections` row owned by the inbox built-in plugin, returned by `api.notifications.channels.$get()`.
- **REQ-008**: Apps tab drops `ipAddress`, `deviceLabel`, `version`, `callsLast24h`, `description` line from row UI; Rotate URL menu item + RotateDialog deleted; `Rename` and `View activity` row actions deleted (no server endpoints exist for either).
- **REQ-009**: `ConnectionStatus` consumed directly from `service_connections.status` column (already typed enum, server-classified). No client-side mapping helper.
- **REQ-010**: `ConnectionStatus` type imported from `@ent-mcp/shared/connections`, never from local mocks. Cross-cutting type sweep ensures no consumer survives `mocks.ts` deletion with a dangling import.
- **REQ-011**: Phase commits do **not** need to keep `vp check` green mid-PR (single PR scope; revertable as a unit). Plan sequenced for review clarity, not green-build invariant per commit. Final commit before merge must pass `vp check && vp test`.
- **CON-001**: No new tables, no new columns this PR. `oauthClient.description` does not exist and will not be added — `description` is always `null` on the wire until follow-up.
- **CON-002**: No new server endpoints. Every wire path maps to a documented existing endpoint.
- **CON-003**: Pre-stable codebase — breaking shared-type changes acceptable, no compat shims (per `project_breaking_changes_ok` memory).
- **CON-004**: No feature flag. Single PR; `git revert` is rollback path.
- **CON-005**: Changeset entry required (`@ent-mcp/client: minor`); release-line in past-tense end-user wording per `CLAUDE.md`.
- **GUD-001**: Co-locate fetchers + query keys + mappers under `apps/client/src/features/settings/data/`.
- **GUD-002**: Suspense boundary + `SettingsErrorBoundary` at tab-component root (existing pattern).
- **GUD-003**: Optimistic mutations for revoke-app, revoke-session, toggle-subscription; non-optimistic for change-password, change-email, delete-account.
- **GUD-004**: Tabs decompose to ≤60-line functions per memory `feedback_no_double_nest_components` and existing settings convention.
- **PAT-001**: Query-key factory pattern (existing `notificationsKeys` shape) — `settingsKeys = { all, profile, role, sessions, apps, mcpEndpoint, publicConfig }`.
- **PAT-002**: Hono RPC return-type inference via `InferResponseType` — no hand-typed DTOs except where transforming.
- **SEC-001**: Delete dialog must require email-match AND password; server enforces both via `api.me.delete.$post`. UI guards alone are insufficient.
- **SEC-002**: Better Auth password-change must pass `revokeOtherSessions: true`.

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Server widenings — `PublicConfig`, `AuthorizedApp`, `MCP_SCOPES` shared.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Create `packages/shared/src/users/mcp-scopes.ts` exporting `MCP_SCOPES = ["mcp.read", "mcp.write.feedback", "mcp.write.request", "mcp.ext"] as const` and `McpScope` type. Re-export via `packages/shared/src/users/index.ts`. | | |
| TASK-002 | Update `apps/server/src/mcp/scopes.ts` to re-export `MCP_SCOPES` and `McpScope` from `@ent-mcp/shared/users`. Keep `parseScopes`, `hasAllScopes`, `missingScopes` server-local helpers. | | |
| TASK-003 | Build the shared package first (`vp run -F @ent-mcp/shared build` or repo-equivalent), then verify all `apps/server/src/**` imports of `MCP_SCOPES` still resolve via re-export. Run `vp check`. | | |
| TASK-004 | Edit `packages/shared/src/users/types.ts`: extend `PublicConfig` to `{ emailEnabled: boolean; mcpEndpointUrl: string; mcpScopes: readonly string[] }`. Extend `AuthorizedApp` with `status: 'active' \| 'idle' \| 'new'` and `description: string \| null`. | | |
| TASK-005 | Edit `apps/server/src/api/procedures/config.ts`: derive `mcpEndpointUrl` from `env.APP_EXTERNAL_URL ?? new URL(c.req.url).origin` plus `/mcp`. Set `mcpScopes` to `[...MCP_SCOPES]`. Return widened `PublicConfig` body. | | |
| TASK-006 | Edit `apps/server/src/api/procedures/me/apps.ts`: rewrite `listAuthorizedApps` SQL to compute `status` via `CASE WHEN MAX(oauthAccessToken.createdAt) > (now-5min) THEN 'active' WHEN MIN(oauthConsent.createdAt) > (now-24h) AND MAX(oauthAccessToken.createdAt) IS NULL THEN 'new' ELSE 'idle' END`. Wrap `oauthConsent.createdAt` with `MIN()` so the expression is aggregated under existing `GROUP BY oauthConsent.clientId`. Add `description: null` to mapped output (column does not exist; leave nullable for future). | | |
| TASK-007 | Update `apps/server/src/api/procedures/__tests__/config.public.test.ts` (or create) to assert `emailEnabled`, `mcpEndpointUrl`, `mcpScopes` shape. | | |
| TASK-008 | Update `apps/server/src/api/procedures/__tests__/me.apps.test.ts` to cover `status='active'` (recent token), `status='new'` (consent <24h, no tokens), `status='idle'` (default), and `description=null`. | | |

### Implementation Phase 2

- GOAL-002: Client data layer — settings query-keys, fetchers, mappers, hooks.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-009 | Create `apps/client/src/features/settings/data/query-keys.ts` exporting `settingsKeys = { all: ['settings'], publicConfig: () => […, 'public-config'], role: () => […, 'role'], sessions: () => […, 'sessions'], apps: () => […, 'apps'] } as const`. | | |
| TASK-010 | Create `apps/client/src/features/settings/data/fetchers.ts` with thin wrappers: `fetchPublicConfig()`, `fetchRole()`, `fetchAuthorizedApps()`, `revokeAuthorizedApp(clientId)`, `deleteAccount(body)`. Each throws on `!res.ok`; uses Hono RPC client from `@/shared/lib/api`. `revokeAuthorizedApp` returns `body.apps` (response body shape is `{ ok: true, apps: AuthorizedApp[] }`). | | |
| TASK-011 | _(removed v1.1 — server already populates `service_connections.status` enum; no client mapper needed)._ | | |
| TASK-012 | Create `apps/client/src/features/settings/data/hooks/use-public-config.ts`: `useSuspenseQuery({ queryKey: settingsKeys.publicConfig(), queryFn: fetchPublicConfig, staleTime: Infinity })`. | | |
| TASK-013 | Create `apps/client/src/features/settings/data/hooks/use-role.ts`: `useSuspenseQuery` keyed off `settingsKeys.role()`. | | |
| TASK-014 | Create `apps/client/src/features/settings/data/hooks/use-authorized-apps.ts`: `useSuspenseQuery` + `useRevokeAuthorizedApp` mutation. On success, seeds query cache directly from `body.apps` (no extra refetch round-trip). | | |
| TASK-015 | Create `apps/client/src/features/settings/data/hooks/use-sessions.ts`: wraps `authClient.listSessions` + revoke/revokeOthers mutations. | | |
| TASK-016 | Update `apps/client/src/features/settings/index.ts` to export public surface from `data/`. | | |
| TASK-016b | _(new v1.1)_ Create `apps/client/src/features/settings/__tests__/test-utils.tsx` exporting `renderWithProviders(ui, { seed?, mocks? })`. Mirror existing pattern in `apps/client/src/features/home/__tests__/use-home-feed.test.tsx` (fresh `QueryClient` per test, wrapped in `QueryClientProvider`, plus `Suspense` boundary for `useSuspenseQuery` callers). | | |
| TASK-017 | Wire `apps/client/src/features/settings/__tests__/` with one test per hook covering happy path + error path. Use `renderWithProviders` from TASK-016b. | | |

### Implementation Phase 3

- GOAL-003: Profile tab — wire `authClient.useSession` + role + emailEnabled.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-018 | Edit `apps/client/src/routes/_authenticated/_settings/settings/profile.tsx`: replace `useState<MockUser>(MOCK_USER)` with `authClient.useSession()`. Branch on `data.user`. | | |
| TASK-019 | Replace `const emailEnabled = true` with `usePublicConfig().data.emailEnabled`. | | |
| TASK-020 | Replace `MOCK_ROLE` reference in `AccountCard` with `useRole().data.role`; render row only when `role !== null`. | | |
| TASK-021 | Wire `NameRow` save → `authClient.updateUser({ name })`; on success invalidate session. Toast on success, inline error under field on failure. | | |
| TASK-022 | Wire `EmailRow` confirm → `authClient.changeEmail({ newEmail, callbackURL: '/settings/profile' })` when `emailEnabled`; deliberate-action dialog → `authClient.changeEmail({ newEmail })` when `!emailEnabled`. Map Better Auth 409/429 → inline/toast per `errors` table in design doc. | | |
| TASK-023 | Wire `VerifyBanner` resend → `authClient.sendVerificationEmail({ email })`; respect 429 retry-after. Banner gates on `emailEnabled && !user.emailVerified`. | | |
| TASK-024 | Remove all imports from `@/features/settings/mocks` in profile route. Remove unused `MockUser` references. | | |
| TASK-025 | Update colocated tests `apps/client/src/features/settings/__tests__/profile.test.tsx` to mock `authClient` + `api.me.role` + `api.config.public`. | | |

### Implementation Phase 4

- GOAL-004: Security tab — sessions list, change password, revoke.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-026 | Edit `apps/client/src/routes/_authenticated/_settings/settings/security.tsx`: replace `useState<ReadonlyArray<MockSession>>(MOCK_SESSIONS)` with `authClient.listSessions()` via `useQuery`. Identify current session via `authClient.useSession().data.session.id`. | | |
| TASK-027 | Wire revoke-one row action → `authClient.revokeSession({ token })`; optimistic remove from cache, rollback on failure. | | |
| TASK-028 | Wire `Sign out everywhere` → `authClient.revokeOtherSessions()`; refetch list. | | |
| TASK-029 | Wire `ChangePasswordCard` submit → `authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true })`. Map 401 to inline error under current-password field. | | |
| TASK-030 | Update `parseUserAgent` consumers — confirm path `@/shared/lib/user-agent` exists; fallback to "Unknown device" + suppressed IP when both `unknown=true`. | | |
| TASK-031 | Remove `MOCK_SESSIONS` import. Remove `MockSession` type usage from this file. | | |
| TASK-032 | Update `apps/client/src/features/settings/__tests__/security.test.tsx` for live session list, current badge, revoke happy/error, password-change happy/wrong-password. | | |

### Implementation Phase 5

- GOAL-005: Connections tab — wire to `api.connections.*`, reuse `ConnectionModal`.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-033 | Edit `apps/client/src/routes/_authenticated/_settings/settings/connections.tsx`: replace `MOCK_CONNECTIONS` with `useSuspenseQuery({ queryKey: ['connections'], queryFn: () => api.connections.$get() })`. | | |
| TASK-034 | Replace `MOCK_PLUGINS` with `useSuspenseQuery` against `api.connections.available.$get()`. | | |
| TASK-035 | Consume `connection.status` directly from the server row — `service_connections.status` is already a typed enum column populated server-side. Replace mock `status` field reads with the live row's `status`. No client-side mapping. | | |
| TASK-036 | Replace inline create/edit dialog with `<ConnectionModal>` from `@/features/connections`. Pass `plugin`/`existing` per modal contract; `onSuccess` invalidates connections query. | | |
| TASK-037 | Wire test/enable-toggle/set-default/delete actions → `api.connections[":id"].test.$post`, `enabled.$patch`, `default.$post`, `$delete`. All invalidate `['connections']` key. | | |
| TASK-038 | Remove all `MOCK_CONNECTIONS`/`MOCK_PLUGINS` references. Remove mock `MockConnection`/`MockPlugin` type imports. Replace the `import { type ConnectionStatus } from "@/features/settings/mocks"` line at [connections.tsx:46](apps/client/src/routes/_authenticated/_settings/settings/connections.tsx#L46) with `import type { ConnectionStatus } from "@ent-mcp/shared/connections"`. Audit other route/component files for the same dangling type import. | | |
| TASK-039 | Update `apps/client/src/features/settings/__tests__/connections.test.tsx` covering status mapping branches + add/edit modal open + delete confirmation. | | |

### Implementation Phase 6

- GOAL-006: Apps tab — wire `api.me.apps`, drop mock-only fields, drop rotate.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-040 | Edit `apps/client/src/routes/_authenticated/_settings/settings/apps.tsx`: replace `MOCK_AUTHORIZED_APPS`/`MOCK_MCP_ENDPOINT`/`MCP_ENDPOINT_SCOPES` with `useAuthorizedApps()` hook + `usePublicConfig()`. | | |
| TASK-041 | Update `useAppsState` to operate on `AuthorizedApp` instead of `MockAuthorizedApp`. Replace local mutating reducer with React Query mutations. | | |
| TASK-042 | Wire revoke action → `api.me.apps[":clientId"].revoke.$post({ param: { clientId } })`. Body shape is `{ ok: true, apps: AuthorizedApp[] }` — read `body.apps` and seed `settingsKeys.apps()` cache directly (no extra refetch). | | |
| TASK-043 | Delete `RotateDialog` component, `confirmRotate` state, `rotate` mutation, `randomToken` helper, `Rotate URL` `DropdownMenuItem`, the `setConfirmRotate` plumbing through `useAppsState` + `AppsDialogs`, and related message keys. Remove keys (en + fa): `settings_apps_endpoint_action_rotate`, `settings_apps_endpoint_rotated`, `settings_apps_rotate_dialog_title`, `settings_apps_rotate_dialog_body`, `settings_apps_rotate_dialog_warning`, `settings_apps_rotate_dialog_confirm`, `settings_apps_toast_rotated`. | | |
| TASK-044 | Replace `McpEndpointMeta`'s `rotatedAt` line with bare authorized-client count. Drop `rotatedAt` from `McpEndpointCard` props. | | |
| TASK-045 | Update `McpEndpointUrl` to consume `publicConfig.data.mcpEndpointUrl`. | | |
| TASK-046 | Update `McpEndpointScopeSummary` to consume `publicConfig.data.mcpScopes` instead of `MCP_ENDPOINT_SCOPES` mock. | | |
| TASK-047 | Edit `apps/client/src/features/settings/components/authorized-app-row.tsx`: drop `ipAddress`, `deviceLabel`, `version`, `callsLast24h`, `description` from row UI. Keep `name`, `status`, `scopes`, `connectedAt`, `lastUsedAt`. Row meta line = `Authorized {date} · Last active {relativeTime(lastUsedAt)}` only. Drop the per-row `Rename` and `View activity` `DropdownMenuItem`s plus `onRename`/`onViewActivity` props (no server endpoints back either action). Remove related message keys (en + fa): `settings_apps_action_rename`, `settings_apps_action_view_activity`, `settings_apps_meta_calls`, `settings_apps_toast_renamed`, `settings_apps_toast_activity_log`, plus `RenameDialog` component + `renameFor` state + `handleRequestRename` plumbing in `useAppsState`. Keep destructive `Revoke access` menu item. | | |
| TASK-048 | Update filter pill set: extend `Filter` type to `'all' \| 'active' \| 'idle' \| 'new'` and add a `New` pill alongside `Active` and `Idle`. Counts come from `status` field on server response (no client derivation). | | |
| TASK-049 | Update bulk revoke: existing endpoint returns full updated list per call. Call sequentially in a single `Promise.all`-equivalent (or `for` loop) and seed cache from the final response. No extra refetch. Document in code comment that no bulk endpoint exists; revisit if user count grows. | | |
| TASK-050 | Drop `MOCK_AUTHORIZED_APPS`, `MOCK_MCP_ENDPOINT`, `MCP_ENDPOINT_SCOPES`, `MockAuthorizedApp`, `MockMcpEndpoint`, `MockAuthorizedAppStatus` imports. | | |
| TASK-051 | Update `apps/client/src/features/settings/__tests__/apps.test.tsx` using `renderWithProviders` from TASK-016b. Cover: live data render, revoke flow seeding cache, filter pills (all 4 including `new`), no-rotate-action, no-rename-action, no-view-activity-action, MCP endpoint URL + scopes from public config. | | |

### Implementation Phase 7

- GOAL-007: Notifications tab — wire `api.notifications.*`, salvage hooks from old module, lock inbox row by `pluginId`, reuse `ConnectionModal` correctly.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-052 | Edit `apps/client/src/routes/_authenticated/_settings/settings/notifications.tsx`: import + reuse the existing salvageable hooks from `apps/client/src/features/notifications/settings/`: `use-channels.ts`, `use-categories.ts`, `use-subscriptions.ts`, `use-toggle-subscription.ts`, `use-test-channel.ts`. They are already correctly wired to `api.notifications.*`. Replace `MOCK_CHANNELS` consumption with `useChannels()`. | | |
| TASK-053 | Replace `MOCK_AVAILABLE_CHANNEL_PLUGINS` with a fresh `useNotificationPlugins` hook (or salvage if present) wrapping `api.notifications.plugins.$get()`. Note: response shape is `{ id, name, description, authKind, supportsKinds, userConfigSchema, iconUrl? }`, **not** the broader `PluginSummary` shape. | | |
| TASK-054 | Replace `MOCK_CATEGORIES` (with client-side `ROLE_RANK` map) with `useCategories()` from salvaged hooks. The server payload carries the `allowed` flag — drop `ROLE_RANK` entirely. | | |
| TASK-055 | Replace `DEFAULT_SUBSCRIPTIONS` + `setSubs` local state with `useSubscriptions()` + `useToggleSubscription()` from salvaged hooks (they already wrap `api.notifications.subscriptions.$get()` + per-cell PUT). Optional bulk path via `api.notifications.subscriptions.bulk.$post` only if multi-toggle UX warrants it. | | |
| TASK-056 | Wire test action → `useTestChannel()` from salvaged hooks (wraps `api.notifications.channels[":id"].test.$post`). | | |
| TASK-057 | Wire `EditChannelDialog` rename/config save → `api.connections[":id"]["display-name"].$patch` (rename) and `api.connections[":id"]["user-config"].$patch` (config). Invalidate `['notifications','channels']` + `['connections']`. | | |
| TASK-058 | Wire `AddChannelDialog`: keep the in-page plugin picker (current redesigned UI). On user picking a plugin, the dialog must hand off to `ConnectionModal` from `@/features/connections` with `plugin: <pickedPlugin mapped to PluginSummary>`. Modal contract is `{ open, plugin, existing, onOpenChange, onSuccess }` — there is **no** `availablePlugins` prop. Add a small mapper that fetches the matching `PluginSummary` (with `version`, `logoUrl`, capabilities) from `api.connections.available.$get()` once the user picks an entry from `api.notifications.plugins`. | | |
| TASK-059 | Wire delete → `api.connections[":id"].$delete`; invalidate `['notifications','channels']` + `['notifications','subscriptions']` + `['connections']`. | | |
| TASK-060 | Inbox row treatment: server returns the inbox `service_connections` row (`pluginId === "inbox"`) via `api.notifications.channels.$get()`. Render that row with locked badge, all-categories-pressed visual, no `Test`/`Edit`/`Delete` buttons. No virtual prepend. Detection helper: `isInboxRow(channel) => channel.pluginId === "inbox"`. | | |
| TASK-061 | Drop `useNotificationsState` hook's local channels/subs state. Mutations replace setState. (Hook stays inline in route file, just wires to query data.) | | |
| TASK-062 | Drop `MOCK_CHANNELS`, `MOCK_AVAILABLE_CHANNEL_PLUGINS`, `MOCK_CATEGORIES`, `DEFAULT_SUBSCRIPTIONS` imports plus `MockChannel`, `ChannelSubscriptions`, `CategoryId` types. Replace `CategoryId` references with shared `NotificationCategory` from `@ent-mcp/shared/notifications`. | | |
| TASK-062b | _(new v1.1)_ After confirming nothing imports the old shell (`features/notifications/settings/notifications-settings-page.tsx`, `channels-section.tsx`, `subscriptions-matrix.tsx`, `channel-card.tsx`, `matrix-row.tsx`, `matrix-cell.tsx`, `channel-test-button.tsx`, `settings-skeleton.tsx`), delete those eight files. Keep the `use-*.ts` hooks + `__fixtures__/` + `__tests__/` directories. Update `features/notifications/settings/index.ts` to export only the salvaged hooks. | | |
| TASK-063 | Update `apps/client/src/features/settings/__tests__/notifications.test.tsx` using `renderWithProviders`. Cover: live channels render, inbox row identified via `pluginId === "inbox"` and locked, subscription toggle calls per-cell PUT, `ConnectionModal` opens with mapped `PluginSummary` after picker, delete invokes connections endpoint, categories with `allowed=false` disabled, no `ROLE_RANK` derivation. | | |

### Implementation Phase 8

- GOAL-008: Danger tab — export anchor nav, real delete flow.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-064 | Edit `apps/client/src/routes/_authenticated/_settings/settings/danger.tsx`: replace `MOCK_USER.email` with `authClient.useSession().data.user.email` for delete-dialog email match. | | |
| TASK-065 | Replace export `setTimeout` simulation with anchor navigation to `/api/me/export`. Use temporary `<a>` element with `download` attribute; click and remove. Show spinner state for ~1s post-click. | | |
| TASK-066 | Replace simulated delete with `api.me.delete.$post({ json: { confirmEmail, currentPassword } })`. On 200: `authClient.signOut()` then `navigate('/auth/login', { replace: true })` with one-shot toast. On 401: inline error under password field. | | |
| TASK-067 | Delete `ReauthDialog` component + `reauthOpen` state (export no longer reauths — anchor nav uses session cookie). **Preserve** these reauth message keys because the Delete dialog still consumes them at [danger.tsx:269,276](apps/client/src/routes/_authenticated/_settings/settings/danger.tsx#L269): `settings_danger_reauth_password_label`, `settings_danger_reauth_password_placeholder`. Delete only the export-specific reauth keys: `settings_danger_reauth_title`, `settings_danger_reauth_description`, `settings_danger_reauth_verifying`, `settings_danger_reauth_cta`. | | |
| TASK-068 | Drop `MOCK_USER` import. | | |
| TASK-069 | Update `apps/client/src/features/settings/__tests__/danger.test.tsx` using `renderWithProviders`. Cover: anchor-nav export (mock `HTMLAnchorElement.click`); delete happy path → `signOut` + redirect; wrong-password → inline error; wrong-email → submit disabled. | | |

### Implementation Phase 9

- GOAL-009: Mock cleanup, message keys, changeset, manual smoke.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-070 | Verify zero remaining imports of `@/features/settings/mocks` via repo grep. | | |
| TASK-071 | Delete `apps/client/src/features/settings/mocks.ts`. | | |
| TASK-072 | Remove obsolete message keys from `apps/client/messages/settings/en.json` **and** `fa.json`. Full list: `settings_apps_endpoint_action_rotate`, `settings_apps_endpoint_rotated`, `settings_apps_rotate_dialog_title`, `settings_apps_rotate_dialog_body`, `settings_apps_rotate_dialog_warning`, `settings_apps_rotate_dialog_confirm`, `settings_apps_toast_rotated`, `settings_apps_action_rename`, `settings_apps_action_view_activity`, `settings_apps_meta_calls`, `settings_apps_toast_renamed`, `settings_apps_toast_activity_log`, `settings_apps_rename_dialog_title`, `settings_apps_rename_dialog_body`, `settings_apps_rename_dialog_placeholder`, `settings_apps_rename_dialog_save`, `settings_danger_reauth_title`, `settings_danger_reauth_description`, `settings_danger_reauth_verifying`, `settings_danger_reauth_cta`. **Keep**: `settings_danger_reauth_password_label`, `settings_danger_reauth_password_placeholder` (used by Delete dialog). Run paraglide regen if required by the project's `vp build` flow. | | |
| TASK-073 | Run `vp check && vp test`. Fix any drift. | | |
| TASK-074 | Add changeset file `.changeset/settings-data-wiring.md` with frontmatter `"@ent-mcp/client": minor` and one-sentence past-tense end-user line: `"Settings tabs now show live account, session, connection, MCP client, notification, and account-deletion data."`. | | |
| TASK-075 | Manual smoke pass on dev deploy: profile name save, email change (both `emailEnabled` states), session revoke, password change w/ session revocation, connection add+test+set-default+delete, app revoke, MCP endpoint URL+scopes render, notification channel add via ConnectionModal mapped to PluginSummary, subscription toggle, inbox row locked (server-supplied), export ZIP download, delete account redirect. | | |

## 3. Alternatives

- **ALT-001**: Add `oauthClient.description` column this PR. Rejected — design doc accepts nullable on wire; separate small PR cleaner; no UI dependency this iteration.
- **ALT-002**: Per-call telemetry table for `callsLast24h`. Rejected — out of scope per design; row UI drops field instead.
- **ALT-003**: Token-issue capture for `ipAddress`/`deviceLabel`. Rejected — out of scope; row UI drops fields.
- **ALT-004**: Per-user MCP URL with `?t=<uuid>` token + rotate. Rejected by user — single MCP mount, OAuth handles authn.
- **ALT-005**: Tab-by-tab PRs. Rejected by user — single PR scope chosen.
- **ALT-006**: Client-side `status` derivation. Rejected — server is single source of truth; SQL `CASE` cheaper than client recompute on every render.
- **ALT-007**: ~~Real inbox subscription rows server-side. Rejected — virtual row honestly reflects "you can't opt out of in-app".~~ **(Reversed v1.1.)** Server already creates an `inbox` `service_connections` row via the inbox built-in plugin (`apps/server/src/notifications/demo-job.ts:146`). Channel list returns it; client locks it by `pluginId === "inbox"`. No virtual prepend.
- **ALT-008**: _(v1.1)_ Client-side `connectionRowToStatus` helper. Rejected after review — `service_connections.status` enum already populated server-side; client-side derivation would diverge.
- **ALT-009**: _(v1.1)_ Per-tab vertical-slice phasing (server widening + client wiring + tests grouped per tab) so each phase commit compiles. Rejected — adds churn for marginal benefit on a single PR; `vp check` runs once at the end.
- **ALT-010**: _(v1.1)_ Rename `settings_danger_reauth_password_label` to `settings_danger_delete_password_label` for naming clarity. Rejected — the existing keys still describe what the UI does (a reauth-password input); renaming churns translation work for no behavior change.

## 4. Dependencies

- **DEP-001**: `better-auth/react` — `authClient.useSession`, `listSessions`, `revokeSession`, `revokeOtherSessions`, `changeEmail`, `changePassword`, `sendVerificationEmail`, `updateUser`, `signOut`. Already installed (≥1.6.5).
- **DEP-002**: `@tanstack/react-query` — already installed.
- **DEP-003**: `hono` RPC client — already installed via `@/shared/lib/api`.
- **DEP-004**: `@ent-mcp/shared/users` — workspace package; widening shared types triggers consumer rebuilds.
- **DEP-005**: Existing `ConnectionModal` from `@/features/connections` — must accept already-filtered `availablePlugins` (verified — modal takes `plugin: PluginSummary | null` prop).
- **DEP-006**: Existing `SettingsErrorBoundary` from `@/shared/components/settings-error-boundary`. No change.
- **DEP-007**: Existing `parseUserAgent` from `@/shared/lib/user-agent`. No change.
- **DEP-008**: `env.APP_EXTERNAL_URL` — already exists in `apps/server/src/env.ts:34`; falls back to `new URL(c.req.url).origin` when undefined.
- **DEP-009**: _(v1.1)_ Existing salvageable hooks at `apps/client/src/features/notifications/settings/use-{channels,categories,subscriptions,toggle-subscription,test-channel}.ts` already wired to `api.notifications.*`. Reused; old UI shell deleted.
- **DEP-010**: _(v1.1)_ Existing test-pattern reference: `apps/client/src/features/home/__tests__/use-home-feed.test.tsx` (`QueryClient` + `QueryClientProvider` per-test). New `renderWithProviders` helper mirrors this.
- **DEP-011**: _(v1.1)_ Shared `ConnectionStatus` type at `@ent-mcp/shared/connections` and `CONNECTION_STATUSES` enum const — already exported.

## 5. Files

### Created

- **FILE-001**: `packages/shared/src/users/mcp-scopes.ts` — `MCP_SCOPES` const + `McpScope` type.
- **FILE-002**: `apps/client/src/features/settings/data/query-keys.ts` — `settingsKeys` factory.
- **FILE-003**: `apps/client/src/features/settings/data/fetchers.ts` — Hono RPC wrappers.
- **FILE-004**: `apps/client/src/features/settings/data/mappers.ts` — `connectionRowToStatus`.
- **FILE-005**: `apps/client/src/features/settings/data/hooks/use-public-config.ts`.
- **FILE-006**: `apps/client/src/features/settings/data/hooks/use-role.ts`.
- **FILE-007**: `apps/client/src/features/settings/data/hooks/use-authorized-apps.ts`.
- **FILE-008**: `apps/client/src/features/settings/data/hooks/use-sessions.ts`.
- **FILE-009**: ~~`apps/client/src/features/settings/components/inbox-row.tsx` — virtual locked row for notifications tab.~~ **(Removed v1.1 — inbox is server-supplied row, not virtual.)**
- **FILE-010**: `.changeset/settings-data-wiring.md`.
- **FILE-010a**: _(v1.1)_ `apps/client/src/features/settings/__tests__/test-utils.tsx` — `renderWithProviders` helper.

### Modified

- **FILE-011**: `apps/server/src/mcp/scopes.ts` — re-export `MCP_SCOPES`/`McpScope` from shared.
- **FILE-012**: `packages/shared/src/users/types.ts` — widen `PublicConfig` and `AuthorizedApp`.
- **FILE-013**: `packages/shared/src/users/index.ts` — re-export from `mcp-scopes.ts`.
- **FILE-014**: `apps/server/src/api/procedures/config.ts` — return widened `PublicConfig`.
- **FILE-015**: `apps/server/src/api/procedures/me/apps.ts` — SQL `CASE` for derived `status`, add `description: null`.
- **FILE-016**: `apps/client/src/features/settings/index.ts` — export `data/` surface.
- **FILE-017**: `apps/client/src/routes/_authenticated/_settings/settings/profile.tsx` — wire to `authClient` + `api.me.role` + `api.config.public`.
- **FILE-018**: `apps/client/src/routes/_authenticated/_settings/settings/security.tsx` — wire to `authClient.listSessions` etc.
- **FILE-019**: `apps/client/src/routes/_authenticated/_settings/settings/connections.tsx` — wire to `api.connections.*`, reuse `ConnectionModal`.
- **FILE-020**: `apps/client/src/routes/_authenticated/_settings/settings/apps.tsx` — wire to `api.me.apps`, `api.config.public`; drop rotate.
- **FILE-021**: `apps/client/src/routes/_authenticated/_settings/settings/notifications.tsx` — wire to `api.notifications.*`, reuse `ConnectionModal`, prepend `<InboxRow />`.
- **FILE-022**: `apps/client/src/routes/_authenticated/_settings/settings/danger.tsx` — wire to `authClient` + `api.me.delete`; anchor-nav export.
- **FILE-023**: `apps/client/src/features/settings/components/authorized-app-row.tsx` — drop `ipAddress`/`deviceLabel`/`version`/`callsLast24h`/`description` from UI.
- **FILE-024**: `apps/client/messages/settings/en.json` — drop Rotate URL keys.
- **FILE-025**: `apps/client/messages/settings/fa.json` — drop Rotate URL keys.
- **FILE-026**: `apps/server/src/api/procedures/__tests__/config.public.test.ts` — assert widened payload.
- **FILE-027**: `apps/server/src/api/procedures/__tests__/me.apps.test.ts` — cover `status` branches.
- **FILE-028**: `apps/client/src/features/settings/__tests__/profile.test.tsx`.
- **FILE-029**: `apps/client/src/features/settings/__tests__/security.test.tsx`.
- **FILE-030**: `apps/client/src/features/settings/__tests__/connections.test.tsx`.
- **FILE-031**: `apps/client/src/features/settings/__tests__/apps.test.tsx`.
- **FILE-032**: `apps/client/src/features/settings/__tests__/notifications.test.tsx`.
- **FILE-033**: `apps/client/src/features/settings/__tests__/danger.test.tsx`.

### Deleted

- **FILE-034**: `apps/client/src/features/settings/mocks.ts`.
- **FILE-035**: Inline `RotateDialog`, `confirmRotate` state, `randomToken`, `MOCK_MCP_ENDPOINT` rotation logic in `apps.tsx`. Plus inline `RenameDialog`, `renameFor` state, rename mutation, `View activity` `DropdownMenuItem`.
- **FILE-036**: Inline `ReauthDialog` in `danger.tsx` (export no longer requires reauth).
- **FILE-037**: _(v1.1)_ Old notifications module shell — `apps/client/src/features/notifications/settings/notifications-settings-page.tsx`, `channels-section.tsx`, `subscriptions-matrix.tsx`, `channel-card.tsx`, `matrix-row.tsx`, `matrix-cell.tsx`, `channel-test-button.tsx`, `settings-skeleton.tsx`. Hooks (`use-channels.ts`, `use-categories.ts`, `use-subscriptions.ts`, `use-toggle-subscription.ts`, `use-test-channel.ts`) preserved.

## 6. Testing

- **TEST-001**: `config.public.test.ts` — assert `{ emailEnabled, mcpEndpointUrl: string ending '/mcp', mcpScopes: string[] }` shape and that `mcpScopes` matches shared `MCP_SCOPES`.
- **TEST-002**: `me.apps.test.ts` — `status='active'` for token within 5 min; `status='new'` for consent within 24 h with no tokens; `status='idle'` otherwise; `description` always `null`.
- **TEST-003**: `profile.test.tsx` — name save invokes `authClient.updateUser`; email change confirmation gates on `emailEnabled`; verify banner only when `emailEnabled && !emailVerified`; resend cooldown countdown.
- **TEST-004**: `security.test.tsx` — sessions list renders, current device badged, revoke removes row optimistically and rolls back on failure, sign-out-everywhere leaves only current, password-change on success collapses form and shows toast, wrong-password shows inline error.
- **TEST-005**: `connections.test.tsx` — status read directly from server row (no client mapper); ConnectionModal opens on add and edit; delete confirmation invokes `api.connections.:id.$delete`; test action invokes RPC.
- **TEST-006**: `apps.test.tsx` — list renders from `api.me.apps`; revoke happy path seeds cache from `body.apps`; filter pills cover all four (`all`/`active`/`idle`/`new`); no Rotate / Rename / View activity menu items present; MCP endpoint URL and scopes from public config.
- **TEST-007**: `notifications.test.tsx` — channels render; inbox row identified via `pluginId === "inbox"` and locked; subscription toggle invokes per-cell PUT; ConnectionModal opens after picker handoff with mapped `PluginSummary`; delete invokes connections endpoint; categories with `allowed=false` disabled.
- **TEST-008**: `danger.test.tsx` — export creates anchor and clicks it (mock `HTMLAnchorElement.click`); delete dialog disabled until both inputs valid; delete success invokes signOut and navigates to login; wrong-password shows inline error.
- **TEST-009**: Manual smoke on dev deploy per TASK-075 covering all flows in both `emailEnabled` states.

## 7. Risks & Assumptions

- **RISK-001**: Hono RPC return-type inference may break across the tree when widening `AuthorizedApp` and `PublicConfig`. Single PR scope means `vp check` runs once at end (per REQ-011); intermediate states will not compile and that is acceptable.
- **RISK-002**: `authClient.listSessions` not React-Query-aware — must wrap in `useQuery({ queryKey, queryFn: () => authClient.listSessions() })`. Verify return shape matches `MockSession`-equivalent.
- **RISK-003**: ~~`ConnectionModal` `availablePlugins` prop~~ **(corrected v1.1.)** Modal takes a single `plugin: PluginSummary | null`. Notifications add-flow picker must map the picked `api.notifications.plugins` entry to a `PluginSummary` from `api.connections.available` before opening the modal. Mapping helper required.
- **RISK-004**: ~~`service_connections` row → `ConnectionStatus` mapping ambiguous.~~ **(Dropped v1.1 — server populates the enum directly.)**
- **RISK-005**: Better Auth `changeEmail` server-side hook may not be wired for `emailEnabled=false` path — `authClient.changeEmail` may still send an email. Verify `auth/config.ts` honours `EMAIL_PROVIDER_CONFIGURED=false` by no-oping `sendChangeEmailConfirmation`.
- **RISK-006**: Anchor-nav export may emit silent failure on server 500 — accepted per design doc; v2 = async job + token-protected download link.
- **RISK-007**: `apps/client/messages/settings/en.json` is open in IDE — message-key removal must align with paraglide regen. Run `vp build` (or paraglide CLI) post-edit.
- **RISK-008**: _(v1.1)_ Salvaged hooks at `features/notifications/settings/use-*.ts` may have query-key collisions with the redesigned settings tab if both surface the same `notificationsKeys.channels()` key. Verify keys before reuse; rename if collision.
- **RISK-009**: _(v1.1)_ Inbox row's `pluginId === "inbox"` detection may not match the runtime — verify by inspecting the demo-job seeded row in dev DB. Fallback: check for `pluginId === "inbox"` AND `isHostPrivilegedPlugin(pluginId)` per `delivery-job.ts:127`.
- **ASSUMPTION-001**: `oauthClient.description` column will not be added this PR; UI omits the description line entirely.
- **ASSUMPTION-002**: Existing tests for `ConnectionModal` cover its core flows; no new modal tests needed beyond settings-tab integration.
- **ASSUMPTION-003**: `authClient.updateUser({ name })` is supported in deployed Better Auth version (≥1.6.5) — confirmed by design doc Better Auth section.
- **ASSUMPTION-004**: _(v1.1 corrected)_ `env.APP_EXTERNAL_URL` exists at `apps/server/src/env.ts:34` or `c.req.url` origin is correct for self-hosted deployments behind reverse proxies (`X-Forwarded-Host` middleware already in place per server config).
- **ASSUMPTION-005**: No Storybook or component-doc updates required — settings components are page-scoped, not in a registry.
- **ASSUMPTION-006**: _(v1.1)_ Inbox `service_connections` row exists for every authenticated user by the time they reach `/settings/notifications` (demo-job seeds it). For brand-new users without the row, behavior is acceptable: tab renders no inbox row until first emit. Backstop UX deferred.

## 8. Related Specifications / Further Reading

- [docs/2026-04-24-user-settings-design.md](../docs/2026-04-24-user-settings-design.md) — User Settings design (amended 2026-05-10)
- [docs/2026-05-06-notifications-client-design.md](../docs/2026-05-06-notifications-client-design.md) — Notifications client design (amended 2026-05-10 — settings inbox virtual row)
- [docs/2026-04-19-frontend-connections-design.md](../docs/2026-04-19-frontend-connections-design.md) — Connections UI plugin-based frontend
- [docs/2026-04-22-frontend-plugin-connections-design.md](../docs/2026-04-22-frontend-plugin-connections-design.md) — Plugin connections superseder
- [docs/2026-04-25-notifications-design.md](../docs/2026-04-25-notifications-design.md) — Notifications system (server)
- [docs/2026-04-29-frontend-structure-design.md](../docs/2026-04-29-frontend-structure-design.md) — Feature-first client layout
- [CLAUDE.md](../CLAUDE.md) — Vite+ workflow, Changesets convention, shared package rules, Frontend Skills directives
