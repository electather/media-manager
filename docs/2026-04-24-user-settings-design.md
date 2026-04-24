# User Settings — Design

**Status:** Draft for review
**Date:** 2026-04-24
**Author:** Omid Astaraki

## Summary

Wire the existing `/settings` mock to real Better Auth and Hono RPC primitives, split it into a nested-route layout with five deep-linkable tabs, and add the account-shaped features that are missing today: email verification (when an email provider is configured), verify-before-switch email change, active-session management, authorized-apps wiring, data export, and a real delete-account flow. The existing `/connections` page is also relocated into this layout as the fifth tab — a move, not a re-design.

This is an implementation contract, not a visual redesign — a dedicated redesign pass follows later. Styling stays inside today's shadcn/ui vocabulary.

## Goals

- Every mocked field in today's `/settings` (name, email, password, MCP endpoint, OAuth clients, delete) is driven by real data and real mutations — no mock constants left.
- Five deep-linkable tabs: `/settings/profile`, `/settings/security`, `/settings/connections`, `/settings/apps`, `/settings/danger`. Bare `/settings` redirects to `/settings/profile`.
- The connections surface (today at `/connections`) is relocated under the settings layout without behaviour or visual changes. The top-level "Connections" sidebar entry is removed. The old `/connections` URL returns 404 — back-compat redirect is explicitly out of scope per the connections scope decision.
- Email-dependent flows degrade gracefully when no email provider is configured on the server (the self-hosted case).
- Identity/security actions use Better Auth's client directly; app-specific actions (role lookup, authorized-app listing with aggregated last-used, export, delete-with-cascade) go through a new Hono sub-app `meApp`.
- A signed-in user can: verify their email, change their email safely, change their password, manage their service connections, see and revoke active sessions, see and revoke authorized MCP apps, export their data as a ZIP, and permanently delete their account.

## Non-goals

- Visual/interaction redesign of the page. Preserved for a later pass.
- Re-designing the connections UI or altering any of its existing flows. The Connections tab is a route relocation only; the existing component, queries, mutations, and modals are kept as-is.
- A back-compat redirect from `/connections` to `/settings/connections`. The old URL 404s.
- 2FA, passkeys, social-account linking. Deferred. The Security tab layout leaves a natural slot for a Two-Factor card above Change Password when the plugin lands, but nothing is scaffolded in v1.
- Profile image upload. Deferred; avatar stays initials-based as today.
- Admin-facing settings (role management, user management). Already live under `/admin`.
- Geolocation of sessions. Parsed user-agent + IP only.
- Async export via the job service. Sync streaming response only.
- Grace period for account deletion. Hard delete on confirm.

## Stack

- **Routing:** TanStack Router nested routes (file-based).
- **State/data:** `authClient` (Better Auth's React client) for identity/session primitives; Hono RPC (`hc<AppType>("/api")`) + TanStack Query for app-specific procedures.
- **UI:** existing shadcn/ui components — no new primitives added.
- **Types:** enums/types cross the client/server boundary via `@ent-mcp/shared/users`. Local UI types stay in the tab files.

No changes to the sidebar. The existing "Settings" entry continues to link to `/settings`; the redirect to `/settings/profile` happens at route resolution.

## File layout

```
packages/client/src/routes/_authenticated/
  settings.tsx              ← layout: page header + left nav + <Outlet/>
  settings/
    index.tsx               ← redirects to ./profile via beforeLoad
    profile.tsx             ← Profile tab
    security.tsx            ← Security tab
    connections.tsx         ← Connections tab (moved from ../connections.tsx)
    apps.tsx                ← Authorized apps tab
    danger.tsx              ← Danger zone tab

packages/client/src/components/settings/
  session-row.tsx           ← shared by Security tab
  authorized-app-row.tsx    ← shared by Apps tab

packages/client/src/lib/
  user-agent.ts             ← ua-parser-js wrapper

packages/server/src/api/procedures/
  me.ts                     ← new: user-scoped account actions
  config.ts                 ← new: public config (emailEnabled)
```

The existing single-file `settings.tsx` is rewritten as the layout shell. Each tab file is its own route component; shared sub-components live in `packages/client/src/components/settings/` so tab files stay focused on layout, queries, and mutations. The Connections tab file is the result of moving `packages/client/src/routes/_authenticated/connections.tsx` — the existing component body, queries, mutations, and modal dependencies are preserved verbatim; only the route path and the `createFileRoute` call site change.

## Route behaviour

- Bare `/settings` renders the layout and redirects to `/settings/profile` via `beforeLoad` on `settings/index.tsx` using TanStack Router's `redirect()` helper.
- The left nav is part of the `settings.tsx` layout and uses `<Link>` with `activeOptions={{ exact: true }}` so the active tab is URL-driven, not local state.
- All five tab routes inherit the `_authenticated` guard on the parent. No per-tab auth logic.
- The public config endpoint `/api/config/public` (no auth) returns `{ emailEnabled: boolean }`. Profile, Security, and the layout read this once via TanStack Query with `staleTime: Infinity` — it's config, not data — and use the flag to gate email-dependent UI. The Connections tab does not read this flag.
- The old `/connections` route file is deleted; TanStack Router's generated route tree drops the path. Requests to `/connections` fall through to the app's existing not-found surface (404). No redirect.
- The top-level "Connections" entry in the app sidebar is removed. Connections is reached only via the Settings left nav.

## Profile tab (`/settings/profile`)

### Data

- `authClient.useSession()` → current `user` (name, email, emailVerified, image, createdAt, updatedAt).
- `api.me.role.$get()` → `{ name: string, description: string | null }`.
- `api.config.public.$get()` → `{ emailEnabled: boolean }` (cached).

### Fields and actions

**Avatar header.** Initials-based `<UserAvatar />` (unchanged), name + email below it. Read-only.

**Name.** `<Input>` bound to a local draft. Save button enabled when dirty. Save calls `authClient.updateUser({ name })`. Success: toast "Name updated"; invalidate session. Error: inline error under the field, preserving the draft.

**Email.**

- When `emailEnabled = true`: `<Input>` + "Change email" button. Submit calls `authClient.changeEmail({ newEmail, callbackURL: '/settings/profile' })`. Better Auth sends a verification link to the **current** email; UI switches to a confirmation state ("We've sent a link to `current@x` — click it to complete the change"). The `user.email` field updates only after the old-address click; `user.emailVerified` flips false on switch. On success, Better Auth fires the post-switch notification to the old address.
- When `emailEnabled = false`: email input + "Change email" button + inline warning _"No verification email will be sent — make sure the new address is correct."_ Submit opens a password-confirm dialog; on confirm, call `authClient.updateUser({ email: newEmail })` directly. No notification to old address.

**Member since.** `format(user.createdAt, 'MMMM yyyy')` → "Member since April 2026". Read-only.

**Role.** Read-only row: role name as a `<Badge>`, description as muted text below. `/me/role` always returns HTTP 200 — an unassigned user gets `{ role: null }`. The client renders the row only when `role !== null`; no error surface for the unassigned case, no toast. "View all roles →" link only if the user has the admin permission (existing permission check).

**Verification banner.** Shown at the top of the Profile tab only (not global) when `emailEnabled && !user.emailVerified`. Copy: _"Verify your email address to secure your account."_ Right-aligned "Resend verification email" button, disabled for 60s after click with a countdown (`Resend in 42s`). Click calls `authClient.sendVerificationEmail({ email: user.email })`. Banner disappears when `emailVerified` flips true. Dismissible per-session via `useState` — no persisted dismissal.

### Error states

- Name update fails → inline field error, draft preserved.
- Email change — address in use: inline error under the email field (Better Auth 409).
- Email change — rate-limited: toast with retry-after.
- Resend verification — rate-limited: toast, countdown jumps to server's retry-after.
- Role fetch failure: hide the row entirely.

### Password field

Moved out of this tab — now lives in Security.

## Security tab (`/settings/security`)

### Data

- `authClient.useSession()` → current session id (to badge "This device").
- `authClient.listSessions()` → all active sessions.

### Change password

Collapsed "Change password" button by default. Expanded form: current password, new password, confirm new password. Client-side validation: min 12 characters, confirm matches new. Submit calls `authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true })`.

- Success: form collapses, toast "Password updated — other sessions signed out", session list refetches.
- Wrong current password: inline error under that field; other fields retained.
- Server validation (password policy): inline under new-password.

### Active sessions

Rows sorted by `updatedAt` descending. Each row:

- Device line: `${browser} on ${os}` via `ua-parser-js` (e.g. "Chrome 135 on macOS"). Raw user-agent in a tooltip on hover.
- Meta line: `${ipAddress} · Signed in ${relativeTime(createdAt)} · Last active ${relativeTime(updatedAt)}`.
- Current session: "This device" badge, no revoke button.
- Other sessions: "Revoke" button → confirmation dialog → `authClient.revokeSession({ token })`. On success: row disappears, toast "Session revoked".
- Missing `userAgent` or `ipAddress`: fall back to "Unknown device" and hide the IP fragment — no empty punctuation.

### Sign out everywhere

Button below the session list. Confirmation dialog ("You'll remain signed in on this device. All other sessions will end."), then `authClient.revokeOtherSessions()`. On success: list refetches, toast.

### Empty & error states

- Zero other sessions: show the current-device row only; hide "Sign out everywhere".
- `listSessions` failure: standard app retry surface.
- Revoke failure: toast, row stays.

### Shared helpers

- `parseUserAgent(ua) → { browser, os, device }` in `packages/client/src/lib/user-agent.ts`.
- `session-row.tsx` component.

## Connections tab (`/settings/connections`)

### Scope

Relocation only. The existing `/connections` page (`packages/client/src/routes/_authenticated/connections.tsx`, ~934 lines, fully wired to the `api.connections.*` surface) is moved under the settings layout. Its data flow, queries, mutations, modal components, capability badges, empty states, and error handling are preserved verbatim. No design work beyond the move.

### What changes

- **Route file:** `packages/client/src/routes/_authenticated/connections.tsx` is moved to `packages/client/src/routes/_authenticated/settings/connections.tsx`. The only code change is the `createFileRoute` path — the component body and all imports are unchanged.
- **Old route file is deleted**; TanStack Router's generated route tree (`routeTree.gen.ts`) regenerates without the old entry.
- **Settings left nav** gains a "Connections" entry between "Security" and "Authorized apps", matching the order in the `Goals` section.
- **App sidebar** loses its top-level "Connections" entry. The existing `Plug`-style icon and label belong to settings' nav exclusively.
- **Inbound links** in the codebase pointing at `/connections` — including any `Link to="/connections"`, email templates (none exist today), or hard-coded strings — are updated to `/settings/connections`. A grep pass covers this.
- **Inbound design references**: the prior connections design docs (`2026-04-19-frontend-connections-design.md`, `2026-04-22-frontend-plugin-connections-design.md`) are amended with a short "route relocated" note at the top pointing at this doc.

### What does not change

- Nothing in the component's behaviour: plugin-driven sections, capability badges, connection modals, schema forms, primary-connection toggling, test-and-save flows — all preserved.
- No server-side work. The `api.connections.*` endpoints are unchanged.
- No new shared types.
- No new tests. Existing component + integration tests move with the route file and keep passing.

### Route-relocation risk

The only way this tab regresses is if the move accidentally drops an import path, a component dependency, or a query-key collision with the settings layout. The PR doing the move runs the full client test suite and a manual smoke pass through the connections flows (add, edit, test, disable, set-primary) to confirm no regression.

### Old URL behaviour

`GET /connections` returns the app's existing not-found surface (TanStack Router's default 404). No banner, no "moved to" hint — per Q2 the break is accepted. If this turns out to matter in practice, a redirect can be added in a follow-up.

## Authorized apps tab (`/settings/apps`)

### Data model

`AuthorizedApp` (shared in `@ent-mcp/shared/users`):

```ts
type AuthorizedApp = {
  clientId: string;
  name: string; // oauthClient.name, fallback to clientId
  scopes: string[]; // from oauthConsent.scopes
  connectedAt: number; // oauthConsent.createdAt for (user, client)
  lastUsedAt: number | null; // max(oauthAccessToken.createdAt), null if never
  ownedByUser: boolean; // oauthClient.userId === currentUser.id
};
```

### Server

- `GET /api/me/apps`: left-join `oauthConsent` with `oauthClient` on `clientId`, filter by `userId`, aggregate `MAX(oauthAccessToken.createdAt)` as `lastUsedAt`. One query, no N+1.
- `POST /api/me/apps/:clientId/revoke`: in a transaction —
  1. Delete all `oauthAccessToken` rows where `userId = currentUser AND clientId = :clientId`.
  2. Delete all `oauthRefreshToken` rows with the same filter. The table has a `revoked` timestamp column that is intentionally unused in this flow — user-initiated revoke is a cleanup action, not an audit event; hard-delete is simpler and the `oauthClient`/`oauthConsent` audit trail already captures who had access.
  3. Delete the `oauthConsent` row for `(userId, clientId)`.
  4. If `oauthClient.userId === currentUser.id` **and** no other `oauthConsent` rows reference this `clientId` (checked in the same transaction), delete the `oauthClient` row. Otherwise the `oauthClient` row stays intact so other users' consents and tokens are untouched. A dedicated "delete this application entirely" surface (owner-level, affects all users) is deferred — it would belong under `/admin` or a future owner-surface, not a per-user revoke.
  5. Return the new list.

Rationale for the guarded client-delete: a revoke action is framed to the user as "remove _my_ authorization". Cascading that into destruction of every other user's access because I happened to be the registrar is a silent-blast-radius bug. Guarding on "no other consents" keeps the cleanup path tidy for the common case (single-user self-hosted deployment where the registrar is also the only consumer) while refusing to go near multi-user state.

### UI

**MCP endpoint.** Unchanged from mock: read-only `InputGroup` with `${window.location.origin}/mcp` and a copy button.

**App list.** Row per app:

- Primary line: `name` (bold), fallback to `clientId` when missing.
- `clientId` in mono below, full and selectable.
- Meta line: `Connected ${relativeTime(connectedAt)} · Last active ${lastUsedAt ? relativeTime(lastUsedAt) : 'never'}`.
- Scope badges.
- "Revoke" button opens confirmation dialog (existing copy). On confirm → revoke mutation, list refetches, toast "Access revoked for ${name}".

**Empty state.** Existing dashed-border card: "No authorized applications — connect an MCP client using the endpoint URL above to get started." The "View setup guides" button from the mock is **dropped** in v1; it can be re-added when a docs page exists.

### Error states

- Fetch failure: standard retry surface.
- Revoke failure: toast error; row stays. Server-side transaction guarantees all-or-nothing.
- Concurrent revoke (already gone): 404 → toast "Already revoked", list refetches.

## Danger zone tab (`/settings/danger`)

### Data

- `authClient.useSession()` for the current email (used in delete-confirmation copy and validation).
- No list data — two action cards.

### Export my data

**Copy.** _"Download a ZIP of your account data — identity, taste profile, feedback history, and connection metadata (no credentials or access tokens)."_

**Action.** Single "Export my data" button. Click triggers a temporary anchor navigation to `GET /api/me/export` (not `fetch`) so the browser's download pipeline handles the stream. Button shows a spinner for the ~1-2s window between click and download starting.

**Response.** `Content-Type: application/zip`, `Content-Disposition: attachment; filename="ent-mcp-export-${userId}-${yyyymmdd}.zip"`. ZIP contents:

```
identity.json            user row (id, name, email, emailVerified, createdAt, updatedAt)
role.json                role name + description
sessions.json            session rows (ip, ua, timestamps)
oauth-apps.json          authorized apps (no tokens, no secrets)
connections.json         service connections (id, pluginId, displayName, createdAt — NO credentials)
primary-connections.json primary_connections rows
taste/
  preference-profiles.json  one row per (userId, mediaType) from preference_profiles
  feedback.json             likes, dislikes, ratings, notes from feedback
jobs.json                job_runs rows where triggeredByUserId = user (history; set-null on delete)
README.txt               "what's in this export" explainer with schema version
```

Table names map to the actual schema in `packages/server/src/db/schema/`: `user`, `session`, `oauth_client`/`oauth_consent`/`oauth_access_token`, `service_connections`, `primary_connections`, `preference_profiles`, `feedback`, `job_runs`. There is no `user_preferences` table — the preference-engine domain is `preference_profiles` + `feedback`.

**Server implementation.** Stream the ZIP with `jszip` in memory — self-hosted, per-user data is small, no temp files needed. All reads run inside a single transaction for a point-in-time-consistent snapshot. Schema-version field in README so future exports can diverge. Generate with `zip.generateAsync({ type: "uint8array" })` (or `"arraybuffer"`) — the default `nodebuffer` type returns a Node `Buffer` which does not exist in the Cloudflare Workers runtime.

**Failure modes.**

- Auth missing: 401, existing middleware redirects to login.
- Transaction error: HTTP 500. Anchor-navigation errors don't bubble through `window.error`, so a silent failure is accepted for v1 — the user sees the browser's default "download failed" UI and can retry. If this becomes a real pain point, the v2 path is an async job with a token-protected download link. Not worth building now.
- Very large user (hypothetical): not optimized for v1. Revisit with async/streaming if it becomes real.

### Delete account

**Copy.** Preserved from mock: _"Permanently delete your account and all associated data — connections, taste profile, feedback history, and preferences. This cannot be undone."_

**Action.** "Delete account" button opens the confirmation dialog. Dialog contains:

- Email-typed input (must match current email exactly).
- Password input.
- "Delete my account" button, disabled until both validate.

**Submit.** `POST /api/me/delete` with `{ confirmEmail, currentPassword }`. Server:

1. Verify password via Better Auth's password helper; fail → 401 "Incorrect password".
2. Verify `confirmEmail === user.email`; fail → 400.
3. Call Better Auth's `deleteUser` on the `user.id`. A single `DELETE` on `user` — FK cascades handle the rest: `session`, `account`, `oauthClient` (user-owned only; other users' clients untouched), `oauthAccessToken`, `oauthRefreshToken`, `oauthConsent`, `userRoles`, `primaryConnections`, `serviceConnections` (+ encrypted credentials), `preferenceProfiles`, `feedback`. `jobRuns.triggeredByUserId` is `SET NULL` by design — history survives the user, anonymized.
4. Return 200 with `{ ok: true }`.

No manual deletion before `deleteUser` — the cascade graph is the source of truth. The FK cascade audit in Prerequisites is what makes this single-call delete safe.

**Client.** On 200: close dialog; the response itself has already invalidated the session cookie (session row is gone server-side, subsequent requests 401), so the client calls `navigate('/auth/login', { replace: true })` with a one-shot toast _"Your account has been deleted."_ A follow-up `authClient.signOut()` is not strictly necessary — the session is dead — but a defensive client-side call to clear any in-memory cache is harmless and keeps the code symmetric with the regular sign-out flow. On 401 (wrong password): inline error under the password field, dialog stays open, inputs retained. Any other error: toast, dialog stays open.

## Server work

### New Hono sub-app: `meApp`

File: `packages/server/src/api/procedures/me.ts`. All routes auth-required via the existing auth middleware used by `activityApp`, `connectionsApp`, etc. Mounted in `router.ts`: `.route("/me", meApp)`.

Handler paths are written relative to the mount point (standard Hono). Each handler is registered with a root-relative path so the Hono RPC client chain follows naturally:

```ts
export const meApp = new Hono()
  .get("/role", ...)
  .get("/apps", ...)
  .post("/apps/:clientId/revoke", ...)
  .get("/export", ...)
  .post("/delete", zValidator("json", DeleteAccountBody), ...);
```

Client RPC calls derived from the chain: `api.me.role.$get()`, `api.me.apps.$get()`, `api.me.apps[":clientId"].revoke.$post({ param: { clientId } })`, `api.me.delete.$post({ json: { ... } })`. The export endpoint is called via anchor navigation, not via the RPC client, so its chain shape doesn't matter for typing.

| Route                       | Method | Body / Params                       | Returns                                                                                                              |
| --------------------------- | ------ | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `/me/role`                  | GET    | —                                   | `{ role: { name, description } \| null }` — always HTTP 200; `role: null` for unassigned users. No 404 for this path |
| `/me/apps`                  | GET    | —                                   | `AuthorizedApp[]`                                                                                                    |
| `/me/apps/:clientId/revoke` | POST   | —                                   | `{ ok: true }`                                                                                                       |
| `/me/export`                | GET    | —                                   | `application/zip` stream                                                                                             |
| `/me/delete`                | POST   | `{ confirmEmail, currentPassword }` | `{ ok: true }` or 401/400                                                                                            |

### New Hono sub-app: `configPublicApp`

File: `packages/server/src/api/procedures/config.ts`. No auth. Mounted at `.route("/config/public", configPublicApp)` with the handler registered at the root path:

```ts
export const configPublicApp = new Hono().get("/", (c) =>
  c.json({ emailEnabled: env.EMAIL_PROVIDER_CONFIGURED }),
);
```

Client call: `api.config.public.$get()`.

`emailEnabled` is derived in `env.ts` so both the Better Auth wiring and this endpoint read the same source. This spec introduces a new env var:

- `EMAIL_PROVIDER_CONFIGURED: boolean` — defaults to `false`. When `true`, Better Auth's `sendVerificationEmail` / `sendChangeEmailVerification` / `sendResetPassword` hooks are wired to the deployment's configured transactional-email sender; when `false`, those hooks are no-ops and the settings UI falls back to the degraded paths described in the Profile tab.

The env var is added to `packages/server/src/env.ts` alongside the existing entries, validated as `z.coerce.boolean().default(false)`. Self-hosted deployments that don't configure email leave it at the default. The deployment design doc should be updated in the same PR to list the new env var.

### Better Auth configuration

- `emailAndPassword.sendChangeEmailVerification` configured to target the **current (old)** email address.
- Post-switch notification to the old address enabled.
- `changePassword` called with `revokeOtherSessions: true`.

These are Better Auth config knobs, not custom code. Verify current installed version supports these (≥ 1.2); bump in the same PR if needed.

### Shared types

Extend `packages/shared/src/users/`:

- `AuthorizedApp` type.
- `RoleSummary` type `{ name: string; description: string | null }`.
- `DeleteAccountBody` zod schema `{ confirmEmail: string, currentPassword: string }`.
- `PublicConfig` type `{ emailEnabled: boolean }`.

Export via the existing `@ent-mcp/shared/users` subpath.

## Prerequisites

These must land before or alongside the main implementation PR:

1. **FK cascade audit.** Verify every table with a `user.id` reference declares `onDelete: "cascade"` (or `set null` where history survival is intentional). From the current schema scan, these already cascade on `user` delete: `session`, `account`, `userRoles`, `oauthClient`, `oauthAccessToken`, `oauthRefreshToken`, `oauthConsent`, `primaryConnections`, `serviceConnections`, `feedback`, `preferenceProfiles`. `jobRuns.triggeredByUserId` is `SET NULL` (intentional — job history survives the user, anonymized). The audit is a safety net: if a new table landed between this design and its implementation and the author forgot the cascade clause, catch it here. Any table that needs a cascade fix gets its migration bundled into this PR.

2. **Composite indexes for MCP app queries.** `oauthAccessToken` and `oauthRefreshToken` have no index on `(userId, clientId)` today. The `/me/apps` aggregation and the revoke transaction both filter on that pair. Add two indexes in a migration bundled with this PR:
   - `oauth_access_token_user_client_idx` on `oauth_access_token(user_id, client_id)`.
   - `oauth_refresh_token_user_client_idx` on `oauth_refresh_token(user_id, client_id)`.
     `oauthConsent` has no index on `(user_id, client_id)` today (confirmed against `db/schema/auth.ts` — only the PK on `id` exists). Add `oauth_consent_user_client_idx` on `oauth_consent(user_id, client_id)` in the same migration. All three tables have nullable `userId`; the queries filter `WHERE user_id = ?` which naturally excludes nulls.

3. **`EMAIL_PROVIDER_CONFIGURED` env var** added to `packages/server/src/env.ts` with `z.coerce.boolean().default(false)`. Documented in `docs/2026-04-24-deployment-design.md` in the same PR.

4. **`ua-parser-js`** added. The root `package.json` uses Bun workspaces with a `catalog:` convention (per the shared user memory and `packages/*/package.json` dep entries like `"better-auth": "catalog:"`). Add `ua-parser-js` to the catalog and reference it as `"ua-parser-js": "catalog:"` from `packages/client/package.json`.

5. **`jszip`** added to the catalog the same way, referenced as `"jszip": "catalog:"` from `packages/server/package.json`. Only the `type: "uint8array"` / `type: "arraybuffer"` output modes are Workers-compatible; the default `nodebuffer` is not.

6. **Better Auth capabilities.** The deployed version is 1.6.5 (`package.json` catalog). Core client methods `authClient.listSessions()`, `authClient.revokeSession()`, `authClient.revokeOtherSessions()`, and `authClient.changeEmail()` are available in 1.x without extra plugins. The `changePassword({ revokeOtherSessions: true })` option and `sendChangeEmailVerification` config knob are also core. No version bump or plugin install needed.

## Error handling

Handlers throw through the existing `errorHandler` in `router.ts`. Everything listed here maps to an existing `HttpError` subtype in `packages/server/src/errors/` — no new error classes.

| Failure                                          | HTTP | Client surface                           |
| ------------------------------------------------ | ---- | ---------------------------------------- |
| Auth missing / expired                           | 401  | Redirect to login (existing middleware)  |
| Validation failure                               | 400  | Inline field errors from zod issues      |
| Wrong current password (change-password, delete) | 401  | Inline error under the password field    |
| Email already in use                             | 409  | Inline error under the email field       |
| Rate-limited (resend / change-email)             | 429  | Toast with retry-after                   |
| Concurrent revoke (already gone)                 | 404  | Toast "Already revoked", list refetches  |
| Unexpected                                       | 500  | Standard app error toast with request id |

## Testing

Follows the existing test pattern — server tests in `packages/server/src/__tests__/`, client tests colocated with components.

### Server tests (new)

- `me.role.test.ts` — returns `{ role: { name, description } }` for an assigned user, `{ role: null }` for unassigned; both cases HTTP 200.
- `me.apps.test.ts` — list shape, last-used aggregation, revoke cascade (tokens + consent deleted; user-owned client deleted; another user's client untouched).
- `me.export.test.ts` — ZIP structure, schema-version in README, no credential fields leak in any JSON.
- `me.delete.test.ts` — happy path, wrong password (401), wrong email (400), cascade completeness (assert no orphan rows for the deleted user id across every FK-bearing table — the most important test in this set).
- `config.public.test.ts` — both `emailEnabled` branches.

### Client tests (new)

- Profile tab: name-save, email-change opens confirmation state, verification banner visibility gates on `emailEnabled`, resend countdown.
- Security tab: session list renders, current session badged, revoke removes row, sign-out-everywhere leaves only current, password change form.
- Apps tab: list renders, empty state, revoke confirmation + mutation.
- Danger tab: export triggers an anchor download (mock `HTMLAnchorElement.click`), delete dialog button disabled until both inputs valid, wrong-password flow.
- Nested-routing redirect: `/settings` → `/settings/profile`.

## Rollout

Single PR strategy, no feature flag:

1. Prerequisites (cascade-audit migration, deps) merge first, possibly in a separate small PR if any cascade fixes are needed.
2. Server `meApp` + `configPublicApp` + tests.
3. Better Auth config changes (`sendChangeEmailVerification`, `revokeOtherSessions`).
4. Client nested-route split + tab files wired against the new surface.
5. Connections route relocation: move the component to `settings/connections.tsx`, delete the old route file, add the settings nav entry, remove the top-level sidebar entry, sweep inbound `/connections` links.
6. Test suite green, manual walkthrough of every flow in both `emailEnabled` states on a dev deploy, plus a smoke pass through the connections flows (add/edit/test/disable/set-primary) to confirm the move didn't regress anything.
7. Changeset file added per the repo's `CLAUDE.md` convention.

No data migration beyond the cascade audit. No rollback plan needed beyond `git revert` — no destructive migrations in this set. The connections move is purely a file relocation and can be reverted by restoring the old route file if anything unexpected surfaces.
