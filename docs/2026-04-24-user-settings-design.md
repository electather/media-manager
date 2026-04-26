# User Settings — Design

**Status:** Draft
**Date:** 2026-04-24
**Author:** Omid Astaraki

## Summary

Wire existing `/settings` mock to real Better Auth + Hono RPC. Split into nested-route layout, 5 deep-linkable tabs. Add missing account features: email verification (when email provider configured), verify-before-switch email change, active-session mgmt, authorized-apps wiring, data export, real delete-account flow. Existing `/connections` page relocates into layout as 5th tab — move only, no redesign.

Implementation contract, not visual redesign. Styling stays in today's shadcn/ui vocabulary.

## Goals

- ∀ mocked field in `/settings` (name, email, password, MCP endpoint, OAuth clients, delete) → real data & real mutations. No mock constants.
- 5 deep-linkable tabs: `/settings/profile`, `/settings/security`, `/settings/connections`, `/settings/apps`, `/settings/danger`. Bare `/settings` → redirect `/settings/profile`.
- `/connections` relocated under settings layout. No behaviour | visual change. Top-level "Connections" sidebar entry removed. Old `/connections` → 404. No back-compat redirect (out of scope).
- Email-dependent flows degrade gracefully when no email provider configured (self-hosted case).
- Identity/security actions → `authClient` direct. App-specific (role lookup, authorized-app listing w/ aggregated last-used, export, delete-with-cascade) → new Hono sub-app `meApp`.
- Signed-in user can: verify email, change email safely, change password, manage service connections, see & revoke active sessions, see & revoke authorized MCP apps, export data as ZIP, permanently delete account.

## Non-goals

- Visual/interaction redesign. Deferred.
- Connections UI redesign | altering existing flows. Tab is route relocation only.
- Back-compat redirect `/connections` → `/settings/connections`. Old URL 404s.
- 2FA, passkeys, social-account linking. Deferred. Security tab leaves natural slot for Two-Factor card above Change Password. Nothing scaffolded v1.
- Profile image upload. Deferred; avatar stays initials-based.
- Admin-facing settings. Already live under `/admin`.
- Geolocation of sessions. Parsed user-agent + IP only.
- Async export via job service. Sync streaming only.
- Grace period for account deletion. Hard delete on confirm.

## Stack

- **Routing:** TanStack Router nested routes (file-based).
- **State/data:** `authClient` for identity/session primitives; Hono RPC (`hc<AppType>("/api")`) + TanStack Query for app-specific procedures.
- **UI:** existing shadcn/ui — no new primitives.
- **Types:** enums/types cross boundary via `@ent-mcp/shared/users`. Local UI types stay in tab files.

No sidebar changes. Existing "Settings" entry → `/settings`; redirect to `/settings/profile` at route resolution.

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

Existing single-file `settings.tsx` → rewritten as layout shell. Each tab file = own route component. Shared sub-components in `packages/client/src/components/settings/`. Connections tab = result of moving `packages/client/src/routes/_authenticated/connections.tsx` — component body, queries, mutations, modal deps preserved verbatim. Only `createFileRoute` call site changes.

## Route behaviour

V1: bare `/settings` → redirect `/settings/profile` via `beforeLoad` on `settings/index.tsx` using TanStack Router `redirect()`.
V2: left nav uses `<Link>` with `activeOptions={{ exact: true }}` → active tab URL-driven, not local state.
V3: ∀ 5 tab routes inherit `_authenticated` guard from parent. No per-tab auth logic.
V4: `/api/config/public` (no auth) returns `{ emailEnabled: boolean }`. Profile, Security & layout read once via TanStack Query `staleTime: Infinity`. Used to gate email-dependent UI. Connections tab does not read flag.
V5: old `/connections` route file deleted → TanStack Router route tree regenerates without entry. Requests → 404. No redirect.
V6: top-level "Connections" sidebar entry removed. Connections reachable only via Settings left nav.

## Profile tab (`/settings/profile`)

### Data

- `authClient.useSession()` → current `user` (name, email, emailVerified, image, createdAt, updatedAt).
- `api.me.role.$get()` → `{ name: string, description: string | null }`.
- `api.config.public.$get()` → `{ emailEnabled: boolean }` (cached).

### Fields & actions

**Avatar header.** Initials-based `<UserAvatar />` (unchanged), name + email below. Read-only.

**Name.** `<Input>` bound to local draft. Save enabled when dirty. Save → `authClient.updateUser({ name })`. Success: toast "Name updated"; invalidate session. Error: inline error under field, draft preserved.

**Email.**
- `emailEnabled = true`: `<Input>` + "Change email" button. Submit → `authClient.changeEmail({ newEmail, callbackURL: '/settings/profile' })`. Better Auth sends verification link to current email. UI → confirmation state ("We've sent a link to `current@x` — click it to complete the change"). `user.email` updates only after old-address click; `user.emailVerified` → false on switch. Post-switch notification → old address.
- `emailEnabled = false`: email input + "Change email" button + inline warning _"No verification email will be sent — make sure the new address is correct."_ Submit → deliberate-action confirmation dialog (no password field). On confirm → `authClient.changeEmail({ newEmail })`. With Better Auth `sendChangeEmailConfirmation` hook unset, address flips immediately. Dialog guards accidental clicks only — user already authenticated, 2nd password prompt adds no security. No notification to old address.

**Member since.** `format(user.createdAt, 'MMMM yyyy')` → "Member since April 2026". Read-only.

**Role.** Read-only row: role name as `<Badge>`, description as muted text. `/me/role` always → HTTP 200 (`role: null` for unassigned). Row renders only when `role !== null`. No error surface for unassigned case. "View all roles →" link only when user has admin permission.

**Verification banner.** Shown at top of Profile tab only when `emailEnabled && !user.emailVerified`. Copy: _"Verify your email address to secure your account."_ Right-aligned "Resend verification email" button, disabled 60s after click with countdown (`Resend in 42s`). Click → `authClient.sendVerificationEmail({ email: user.email })`. Banner disappears when `emailVerified` flips true. Dismissible per-session via `useState` — no persisted dismissal.

### Error states

| Failure | Surface |
| --- | --- |
| Name update fails | Inline field error, draft preserved |
| Email in use | Inline error under email field (Better Auth 409) |
| Email rate-limited | Toast with retry-after |
| Resend verification rate-limited | Toast; countdown jumps to server retry-after |
| Role fetch failure | Hide row entirely |

Password field → moved to Security tab.

## Security tab (`/settings/security`)

### Data

- `authClient.useSession()` → current session id (to badge "This device").
- `authClient.listSessions()` → all active sessions.

### Change password

Collapsed by default. Expanded: current password, new password, confirm new. Client validation: min 12 chars, confirm matches new. Submit → `authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true })`.
- Success: form collapses, toast "Password updated — other sessions signed out", session list refetches.
- Wrong current password: inline error under that field; other fields retained.
- Server validation (password policy): inline under new-password.

### Active sessions

Sorted by `updatedAt` desc. Each row:
- Device line: `${browser} on ${os}` via `ua-parser-js` (e.g. "Chrome 135 on macOS"). Raw UA in tooltip.
- Meta line: `${ipAddress} · Signed in ${relativeTime(createdAt)} · Last active ${relativeTime(updatedAt)}`.
- Current session: "This device" badge, no revoke button.
- Other sessions: "Revoke" → confirmation dialog → `authClient.revokeSession({ token })`. Success: row disappears, toast "Session revoked".
- Missing `userAgent` | `ipAddress` → fall back to "Unknown device", hide IP fragment. No empty punctuation.

### Sign out everywhere

Button below session list. Confirmation dialog → `authClient.revokeOtherSessions()`. Success: list refetches, toast.

### States

- Zero other sessions: show current-device row only; hide "Sign out everywhere".
- `listSessions` failure: standard retry surface.
- Revoke failure: toast, row stays.

### Shared helpers

- `parseUserAgent(ua) → { label, browser, os, unknown }` in `packages/client/src/lib/user-agent.ts`. `label` = displayable string (e.g. "Chrome 120 on macOS"); `unknown = true` when neither browser nor OS parsed → signal to suppress adjacent metadata (IP).
- `session-row.tsx` component.

## Connections tab (`/settings/connections`)

### Scope

Relocation only. Existing `/connections` page (`packages/client/src/routes/_authenticated/connections.tsx`, ~934 lines, fully wired to `api.connections.*`) moves under settings layout. Data flow, queries, mutations, modal components, capability badges, empty states & error handling preserved verbatim.

### What changes

- **Route file:** `connections.tsx` moves to `settings/connections.tsx`. Only change: `createFileRoute` path. Component body & all imports unchanged.
- **Old route file deleted.** `routeTree.gen.ts` regenerates without old entry.
- **Settings left nav** gains "Connections" between "Security" & "Authorized apps".
- **App sidebar** loses top-level "Connections" entry.
- **Inbound links** pointing at `/connections` → updated to `/settings/connections` (grep pass).
- **Prior design docs** (`2026-04-19-frontend-connections-design.md`, `2026-04-22-frontend-plugin-connections-design.md`) → amended with "route relocated" note pointing at this doc.

### What does not change

- Component behaviour: plugin-driven sections, capability badges, modals, schema forms, primary-connection toggling, test-and-save flows.
- No server-side work. `api.connections.*` unchanged.
- No new shared types.
- No new tests. Existing tests move with route file.

### Risk

Only regression path: move accidentally drops import path, component dep, or query-key collision with settings layout. PR runs full client test suite + manual smoke pass (add, edit, test, disable, set-primary).

### Old URL

`GET /connections` → 404. No banner. No redirect. Follow-up if it matters in practice.

## Authorized apps tab (`/settings/apps`)

### Data model

`AuthorizedApp` (in `@ent-mcp/shared/users`):

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
- `POST /api/me/apps/:clientId/revoke`: transaction —
  1. Delete `oauthAccessToken` rows where `userId = currentUser AND clientId = :clientId`.
  2. Delete `oauthRefreshToken` rows, same filter. `revoked` timestamp col intentionally unused — user-initiated revoke = cleanup, not audit event. Hard-delete simpler; `oauthClient`/`oauthConsent` audit trail captures who had access.
  3. Delete `oauthConsent` row for `(userId, clientId)`.
  4. If `oauthClient.userId === currentUser.id` **&** no other `oauthConsent` rows reference `clientId` (checked in same tx) → delete `oauthClient`. Otherwise `oauthClient` stays → other users' consents & tokens untouched. Owner-level "delete app entirely" deferred → `/admin` | future owner-surface.
  5. Return new list.

Rationale: revoke = "remove my authorization". Cascading → destroy every other user's access = silent-blast-radius bug. Guard on "no other consents" keeps cleanup tidy for common single-user self-hosted case while refusing to touch multi-user state.

### UI

**MCP endpoint.** Read-only `InputGroup` with `${window.location.origin}/mcp` + copy button.

**App list.** Row per app:
- Primary line: `name` (bold), fallback to `clientId`.
- `clientId` mono below, full & selectable.
- Meta: `Connected ${relativeTime(connectedAt)} · Last active ${lastUsedAt ? relativeTime(lastUsedAt) : 'never'}`.
- Scope badges.
- "Revoke" → confirmation dialog. On confirm → revoke mutation, list refetches, toast "Access revoked for ${name}".

**Empty state.** Dashed-border card: "No authorized applications — connect an MCP client using the endpoint URL above to get started." "View setup guides" button dropped v1 (no docs page exists).

### Error states

| Failure | Surface |
| --- | --- |
| Fetch failure | Standard retry surface |
| Revoke failure | Toast error; row stays. Tx = all-or-nothing |
| Concurrent revoke (already gone) | 404 → toast "Already revoked", list refetches |

## Danger zone tab (`/settings/danger`)

### Data

- `authClient.useSession()` → current email (for delete copy & validation).
- No list data — two action cards.

### Export my data

**Copy.** _"Download a ZIP of your account data — identity, taste profile, feedback history, and connection metadata (no credentials or access tokens)."_

**Action.** "Export my data" button. Click → temporary anchor nav to `GET /api/me/export` (not `fetch`) — browser download pipeline handles stream. Button shows spinner for ~1-2s before download starts.

**Response.** `Content-Type: application/zip`, `Content-Disposition: attachment; filename="ent-mcp-export-${userId}-${yyyymmdd}.zip"`. ZIP:

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

Table names map to schema in `packages/server/src/db/schema/`: `user`, `session`, `oauth_client`/`oauth_consent`/`oauth_access_token`, `service_connections`, `primary_connections`, `preference_profiles`, `feedback`, `job_runs`. No `user_preferences` table — preference domain = `preference_profiles` + `feedback`.

**Server impl.** Stream ZIP with `jszip` in memory — self-hosted, per-user data small, no temp files. All reads in single tx for point-in-time-consistent snapshot. Schema-version in README. Use `zip.generateAsync({ type: "uint8array" })` | `"arraybuffer"` — default `nodebuffer` not Workers-compatible.

**Failure modes.**
- Auth missing → 401; existing middleware → login.
- Tx error → 500. Anchor-nav errors don't bubble through `window.error` → silent failure accepted v1. User sees browser "download failed" UI + can retry. v2 path = async job + token-protected download link. Not worth building now.
- Very large user (hypothetical): not optimized v1.

### Delete account

**Copy.** _"Permanently delete your account and all associated data — connections, taste profile, feedback history, and preferences. This cannot be undone."_

**Action.** "Delete account" → confirmation dialog. Dialog:
- Email-typed input (must match current email exactly).
- Password input.
- "Delete my account" button, disabled until both valid.

**Submit.** `POST /api/me/delete` with `{ confirmEmail, currentPassword }`. Server:
1. Verify password via Better Auth password helper; fail → 401 "Incorrect password".
2. Verify `confirmEmail === user.email`; fail → 400.
3. `deleteUser(user.id)`. Single `DELETE` on `user` — FK cascades handle rest: `session`, `account`, `oauthClient` (user-owned only), `oauthAccessToken`, `oauthRefreshToken`, `oauthConsent`, `userRoles`, `primaryConnections`, `serviceConnections` (+ encrypted credentials), `preferenceProfiles`, `feedback`. `jobRuns.triggeredByUserId` → `SET NULL` — history survives, anonymized.
4. Return `{ ok: true }`.

No manual deletion before `deleteUser` — cascade graph = source of truth.

**Client.** On 200: close dialog; session cookie already invalid (session row gone server-side) → `navigate('/auth/login', { replace: true })` + one-shot toast _"Your account has been deleted."_ Defensive `authClient.signOut()` call clears in-memory cache — session already dead, harmless. On 401: inline error under password field, dialog stays, inputs retained. Other error: toast, dialog stays.

## Server work

### `meApp`

File: `packages/server/src/api/procedures/me.ts`. All routes auth-required. Mounted in `router.ts`: `.route("/me", meApp)`.

```ts
export const meApp = new Hono()
  .get("/role", ...)
  .get("/apps", ...)
  .post("/apps/:clientId/revoke", ...)
  .get("/export", ...)
  .post("/delete", zValidator("json", DeleteAccountBody), ...);
```

Client RPC: `api.me.role.$get()`, `api.me.apps.$get()`, `api.me.apps[":clientId"].revoke.$post({ param: { clientId } })`, `api.me.delete.$post({ json: { ... } })`. Export → anchor nav, not RPC client.

| Route | Method | Body / Params | Returns |
| --- | --- | --- | --- |
| `/me/role` | GET | — | `{ role: { name, description } \| null }` — always HTTP 200 |
| `/me/apps` | GET | — | `AuthorizedApp[]` |
| `/me/apps/:clientId/revoke` | POST | — | `{ ok: true }` |
| `/me/export` | GET | — | `application/zip` stream |
| `/me/delete` | POST | `{ confirmEmail, currentPassword }` | `{ ok: true }` \| 401/400 |

### `configPublicApp`

File: `packages/server/src/api/procedures/config.ts`. No auth. Mounted: `.route("/config/public", configPublicApp)`.

```ts
export const configPublicApp = new Hono().get("/", (c) =>
  c.json({ emailEnabled: env.EMAIL_PROVIDER_CONFIGURED }),
);
```

Client call: `api.config.public.$get()`.

`emailEnabled` derived in `env.ts` — Better Auth wiring & this endpoint share same source.

New env var:
- `EMAIL_PROVIDER_CONFIGURED: boolean` — default `false`. When `true`, Better Auth's `sendVerificationEmail` / `sendChangeEmailConfirmation` / `sendResetPassword` hooks wired to transactional-email sender. When `false`, hooks = no-ops; settings UI falls back to degraded paths.

Add to `packages/server/src/env.ts`: `z.coerce.boolean().default(false)`.

### Better Auth config

- `user.changeEmail.sendChangeEmailConfirmation` → targets current (old) email (Better Auth 1.6 hook name; old revisions used `sendChangeEmailVerification`).
- Post-switch notification to old address enabled.
- `changePassword` called with `revokeOtherSessions: true`.

Config knobs only, no custom code. Verify installed version ≥ 1.2; bump in same PR if needed.

### Shared types

Extend `packages/shared/src/users/`:
- `AuthorizedApp` type.
- `RoleSummary` type `{ name: string; description: string | null }`.
- `DeleteAccountBody` zod schema `{ confirmEmail: string, currentPassword: string }`.
- `PublicConfig` type `{ emailEnabled: boolean }`.

Export via `@ent-mcp/shared/users` subpath.

## Prerequisites

Must land before | alongside main PR:

1. **FK cascade audit.** Verify every table with `user.id` ref declares `onDelete: "cascade"` (or `set null` where history survival intentional). Already cascade on `user` delete: `session`, `account`, `userRoles`, `oauthClient`, `oauthAccessToken`, `oauthRefreshToken`, `oauthConsent`, `primaryConnections`, `serviceConnections`, `feedback`, `preferenceProfiles`. `jobRuns.triggeredByUserId` = `SET NULL` (intentional). Any table needing cascade fix → migration bundled in this PR.

2. **Composite indexes.** `oauthAccessToken` & `oauthRefreshToken` lack index on `(userId, clientId)`. Add in migration:
   - `oauth_access_token_user_client_idx` on `oauth_access_token(user_id, client_id)`.
   - `oauth_refresh_token_user_client_idx` on `oauth_refresh_token(user_id, client_id)`.
   - `oauth_consent_user_client_idx` on `oauth_consent(user_id, client_id)` (confirmed: only PK on `id` exists in `db/schema/auth.ts`).
   All 3 tables have nullable `userId`; queries filter `WHERE user_id = ?` → naturally excludes nulls.

3. **`EMAIL_PROVIDER_CONFIGURED` env var** in `packages/server/src/env.ts`, `z.coerce.boolean().default(false)`. Document in `docs/2026-04-24-deployment-design.md` in same PR.

4. **`ua-parser-js`** added to catalog. Reference as `"ua-parser-js": "catalog:"` from `packages/client/package.json`.

5. **`jszip`** added to catalog. Reference as `"jszip": "catalog:"` from `packages/server/package.json`. Only `type: "uint8array"` | `"arraybuffer"` output modes Workers-compatible; default `nodebuffer` is not.

6. **Better Auth capabilities.** Deployed version: 1.6.5. `authClient.listSessions()`, `authClient.revokeSession()`, `authClient.revokeOtherSessions()`, `authClient.changeEmail()` available in 1.x without extra plugins. `changePassword({ revokeOtherSessions: true })` & `user.changeEmail.sendChangeEmailConfirmation` = core. No version bump | plugin install needed.

## Error handling

Handlers throw through existing `errorHandler` in `router.ts`. All map to existing `HttpError` subtype in `packages/server/src/errors/` — no new error classes.

| Failure | HTTP | Client surface |
| --- | --- | --- |
| Auth missing / expired | 401 | Redirect to login (existing middleware) |
| Validation failure | 400 | Inline field errors from zod issues |
| Wrong current password (change-password, delete) | 401 | Inline error under password field |
| Email already in use | 409 | Inline error under email field |
| Rate-limited (resend / change-email) | 429 | Toast with retry-after |
| Concurrent revoke (already gone) | 404 | Toast "Already revoked", list refetches |
| Unexpected | 500 | Standard app error toast with request id |

## Testing

Server tests in `packages/server/src/__tests__/`. Client tests colocated with components.

### Server tests (new)

- `me.role.test.ts` — `{ role: { name, description } }` for assigned user, `{ role: null }` for unassigned; both HTTP 200.
- `me.apps.test.ts` — list shape, last-used aggregation, revoke cascade (tokens + consent deleted; user-owned client deleted; another user's client untouched).
- `me.export.test.ts` — ZIP structure, schema-version in README, no credential fields leak in any JSON.
- `me.delete.test.ts` — happy path, wrong password (401), wrong email (400), cascade completeness (assert no orphan rows for deleted user across every FK-bearing table).
- `config.public.test.ts` — both `emailEnabled` branches.

### Client tests (new)

- Profile: name-save, email-change → confirmation state, verification banner gates on `emailEnabled`, resend countdown.
- Security: session list renders, current session badged, revoke removes row, sign-out-everywhere leaves only current, password change form.
- Apps: list renders, empty state, revoke confirmation + mutation.
- Danger: export triggers anchor download (mock `HTMLAnchorElement.click`), delete dialog disabled until both inputs valid, wrong-password flow.
- Nested routing redirect: `/settings` → `/settings/profile`.

## Rollout

Single PR, no feature flag.

1. Prerequisites (cascade-audit migration, deps) — may be separate small PR if cascade fixes needed.
2. Server `meApp` + `configPublicApp` + tests.
3. Better Auth config (`user.changeEmail.sendChangeEmailConfirmation`, `revokeOtherSessions`).
4. Client nested-route split + tab files wired to new surface.
5. Connections route relocation: move component to `settings/connections.tsx`, delete old route file, add settings nav entry, remove top-level sidebar entry, sweep inbound `/connections` links.
6. Test suite green. Manual walkthrough ∀ flow in both `emailEnabled` states on dev deploy. Smoke pass through connections flows (add/edit/test/disable/set-primary).
7. Changeset file added per `CLAUDE.md` convention.

No data migration beyond cascade audit. No rollback plan beyond `git revert` — no destructive migrations. Connections move = file relocation only; revert by restoring old route file.
