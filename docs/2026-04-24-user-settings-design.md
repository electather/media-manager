# User Settings — Design

**Status:** Draft for review
**Date:** 2026-04-24
**Author:** Omid Astaraki

## Summary

Wire the existing `/settings` mock to real Better Auth and Hono RPC primitives, split it into a nested-route layout with four deep-linkable tabs, and add the account-shaped features that are missing today: email verification (when an email provider is configured), verify-before-switch email change, active-session management, authorized-apps wiring, data export, and a real delete-account flow.

This is an implementation contract, not a visual redesign — a dedicated redesign pass follows later. Styling stays inside today's shadcn/ui vocabulary.

## Goals

- Every mocked field in today's `/settings` (name, email, password, MCP endpoint, OAuth clients, delete) is driven by real data and real mutations — no mock constants left.
- Four deep-linkable tabs: `/settings/profile`, `/settings/security`, `/settings/apps`, `/settings/danger`. Bare `/settings` redirects to `/settings/profile`.
- Email-dependent flows degrade gracefully when no email provider is configured on the server (the self-hosted case).
- Identity/security actions use Better Auth's client directly; app-specific actions (role lookup, authorized-app listing with aggregated last-used, export, delete-with-cascade) go through a new Hono sub-app `meApp`.
- A signed-in user can: verify their email, change their email safely, change their password, see and revoke active sessions, see and revoke authorized MCP apps, export their data as a ZIP, and permanently delete their account.

## Non-goals

- Visual/interaction redesign of the page. Preserved for a later pass.
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

The existing single-file `settings.tsx` is rewritten as the layout shell. Each tab file is its own route component; shared sub-components live in `packages/client/src/components/settings/` so tab files stay focused on layout, queries, and mutations.

## Route behaviour

- Bare `/settings` renders the layout and redirects to `/settings/profile` via `beforeLoad` on `settings/index.tsx` using TanStack Router's `redirect()` helper.
- The left nav is part of the `settings.tsx` layout and uses `<Link>` with `activeOptions={{ exact: true }}` so the active tab is URL-driven, not local state.
- All four tab routes inherit the `_authenticated` guard on the parent. No per-tab auth logic.
- The public config endpoint `/api/config/public` (no auth) returns `{ emailEnabled: boolean }`. Profile, Security, and the layout read this once via TanStack Query with `staleTime: Infinity` — it's config, not data — and use the flag to gate email-dependent UI.

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
- When `emailEnabled = false`: email input + "Change email" button + inline warning *"No verification email will be sent — make sure the new address is correct."* Submit opens a password-confirm dialog; on confirm, call `authClient.updateUser({ email: newEmail })` directly. No notification to old address.

**Member since.** `format(user.createdAt, 'MMMM yyyy')` → "Member since April 2026". Read-only.

**Role.** Read-only row: role name as a `<Badge>`, description as muted text below. "View all roles →" link only if the user has the admin permission (existing permission check).

**Verification banner.** Shown at the top of the Profile tab only (not global) when `emailEnabled && !user.emailVerified`. Copy: *"Verify your email address to secure your account."* Right-aligned "Resend verification email" button, disabled for 60s after click with a countdown (`Resend in 42s`). Click calls `authClient.sendVerificationEmail({ email: user.email })`. Banner disappears when `emailVerified` flips true. Dismissible per-session via `useState` — no persisted dismissal.

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

## Authorized apps tab (`/settings/apps`)

### Data model

`AuthorizedApp` (shared in `@ent-mcp/shared/users`):

```ts
type AuthorizedApp = {
  clientId: string;
  name: string;                    // oauthClient.name, fallback to clientId
  scopes: string[];                // from oauthConsent.scopes
  connectedAt: number;             // oauthConsent.createdAt for (user, client)
  lastUsedAt: number | null;       // max(oauthAccessToken.createdAt), null if never
  ownedByUser: boolean;            // oauthClient.userId === currentUser.id
};
```

### Server

- `GET /api/me/apps`: left-join `oauthConsent` with `oauthClient` on `clientId`, filter by `userId`, aggregate `MAX(oauthAccessToken.createdAt)` as `lastUsedAt`. One query, no N+1.
- `POST /api/me/apps/:clientId/revoke`: in a transaction —
  1. Delete all `oauthAccessToken` rows where `userId = currentUser AND clientId = :clientId`.
  2. Delete all `oauthRefreshToken` rows with the same filter.
  3. Delete the `oauthConsent` row for `(userId, clientId)`.
  4. If `oauthClient.userId === currentUser.id`, delete the `oauthClient` row as well.
  5. Return the new list.

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

**Copy.** *"Download a ZIP of your account data — identity, taste profile, feedback history, and connection metadata (no credentials or access tokens)."*

**Action.** Single "Export my data" button. Click triggers a temporary anchor navigation to `GET /api/me/export` (not `fetch`) so the browser's download pipeline handles the stream. Button shows a spinner for the ~1-2s window between click and download starting.

**Response.** `Content-Type: application/zip`, `Content-Disposition: attachment; filename="ent-mcp-export-${userId}-${yyyymmdd}.zip"`. ZIP contents:

```
identity.json      user row (id, name, email, emailVerified, createdAt, updatedAt)
role.json          role name + description
sessions.json      session rows (ip, ua, timestamps)
oauth-apps.json    authorized apps (no tokens, no secrets)
connections.json   service connections (id, service, displayName, createdAt — NO credentials)
primary-connections.json
taste/
  preference-profile.json
  feedback.json    likes, dislikes, ratings, notes
  preferences.json user-preference rows
jobs.json          job run history attributable to the user
README.txt         "what's in this export" explainer with schema version
```

**Server implementation.** Stream the ZIP with `jszip` in memory — self-hosted, per-user data is small, no temp files needed. All reads run inside a single transaction for a point-in-time-consistent snapshot. Schema-version field in README so future exports can diverge.

**Failure modes.**
- Auth missing: 401, existing middleware redirects to login.
- Transaction error: HTTP 500. The anchor click fails silently; a `window` error listener scoped to the export click shows a toast "Export failed — try again".
- Very large user (hypothetical): not optimized for v1. Revisit with async/streaming if it becomes real.

### Delete account

**Copy.** Preserved from mock: *"Permanently delete your account and all associated data — connections, taste profile, feedback history, and preferences. This cannot be undone."*

**Action.** "Delete account" button opens the confirmation dialog. Dialog contains:
- Email-typed input (must match current email exactly).
- Password input.
- "Delete my account" button, disabled until both validate.

**Submit.** `POST /api/me/delete` with `{ confirmEmail, currentPassword }`. Server:
1. Verify password via Better Auth's password helper; fail → 401 "Incorrect password".
2. Verify `confirmEmail === user.email`; fail → 400.
3. Transaction:
   - Revoke all `oauthAccessToken` / `oauthRefreshToken` / `oauthConsent` for the user.
   - Delete `oauthClient` rows where `userId = currentUser`.
   - Delete all `session` rows (forces immediate sign-out everywhere after response).
   - Call Better Auth's `deleteUser` on the `user` row. FK cascades handle: `account`, `userRoles`, `primaryConnections`, `serviceConnections` + encrypted credentials, `userPreferences`, taste-engine rows, feedback, jobs.
4. Return 200 with `{ ok: true }`.

**Client.** On 200: close dialog, `authClient.signOut()` to clear in-memory session state, then `navigate('/auth/login', { replace: true })` with a one-shot toast *"Your account has been deleted."* On 401 (wrong password): inline error under the password field, dialog stays open, inputs retained. Any other error: toast, dialog stays open.

## Server work

### New Hono sub-app: `meApp`

File: `packages/server/src/api/procedures/me.ts`. All routes auth-required via the existing auth middleware used by `activityApp`, `connectionsApp`, etc. Mounted in `router.ts`: `.route("/me", meApp)`.

| Route | Method | Body / Params | Returns |
|---|---|---|---|
| `/me/role` | GET | — | `{ name, description }` or 404 if unassigned |
| `/me/apps` | GET | — | `AuthorizedApp[]` |
| `/me/apps/:clientId/revoke` | POST | — | `{ ok: true }` |
| `/me/export` | GET | — | `application/zip` stream |
| `/me/delete` | POST | `{ confirmEmail, currentPassword }` | `{ ok: true }` or 401/400 |

### New Hono sub-app: `configPublicApp`

File: `packages/server/src/api/procedures/config.ts`. No auth. Mounted at `.route("/config/public", configPublicApp)`.

| Route | Method | Returns |
|---|---|---|
| `/config/public` | GET | `{ emailEnabled: boolean }` |

`emailEnabled` is derived in `env.ts` so both the Better Auth wiring and this endpoint read the same source. Truth-source: presence of a configured email provider in the deployment env (single flag `EMAIL_PROVIDER_CONFIGURED`, or equivalent presence-check of SMTP-style env vars — matches the convention already established in the existing deployment design).

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

1. **FK cascade audit.** Verify every table with a `userId` column declares `onDelete: "cascade"`. A one-off script can enumerate all such tables. From the current schema scan: `session`, `account`, `userRoles`, `oauthClient`, `oauthAccessToken`, `oauthRefreshToken`, `oauthConsent`, `primaryConnections` already cascade. Tables to verify: `serviceConnections` (and its encrypted-credential rows), `userPreferences`, every preference-engine table, feedback tables, job-runs table. Any that don't get a migration bundled into this work.

2. **`ua-parser-js`** added to `packages/client/package.json`.

3. **`jszip`** added to `packages/server/package.json`. Confirmed compatible with the Cloudflare Workers runtime (no Node-only deps).

4. **Better Auth version check.** Confirm current version supports `changeEmail` with old-email verification and `revokeOtherSessions` on `changePassword`. Both documented on Better Auth ≥ 1.2.

## Error handling

Handlers throw through the existing `errorHandler` in `router.ts`. Everything listed here maps to an existing `HttpError` subtype in `packages/server/src/errors/` — no new error classes.

| Failure | HTTP | Client surface |
|---|---|---|
| Auth missing / expired | 401 | Redirect to login (existing middleware) |
| Validation failure | 400 | Inline field errors from zod issues |
| Wrong current password (change-password, delete) | 401 | Inline error under the password field |
| Email already in use | 409 | Inline error under the email field |
| Rate-limited (resend / change-email) | 429 | Toast with retry-after |
| Concurrent revoke (already gone) | 404 | Toast "Already revoked", list refetches |
| Unexpected | 500 | Standard app error toast with request id |

## Testing

Follows the existing test pattern — server tests in `packages/server/src/__tests__/`, client tests colocated with components.

### Server tests (new)

- `me.role.test.ts` — returns assigned role, 404 when unassigned.
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
5. Test suite green, manual walkthrough of every flow in both `emailEnabled` states on a dev deploy.
6. Changeset file added per the repo's `CLAUDE.md` convention.

No data migration beyond the cascade audit. No rollback plan needed beyond `git revert` — no destructive migrations in this set.
