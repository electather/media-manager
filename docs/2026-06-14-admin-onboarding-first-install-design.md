# First-Install Admin Onboarding — Design

- **Date:** 2026-06-14
- **Status:** Implemented (see [Implementation notes](#implementation-notes-as-built))
- **Related:**
  - `docs/2026-05-20-client-authorization-design.md` (route guards, permissions)
  - `docs/2026-04-22-frontend-plugin-connections-design.md` (connections UI)
  - `docs/2026-04-24-plugin-advanced-admin-design.md` (admin plugins / shared credentials)
  - `docs/2026-04-24-deployment-design.md` (self-hosted deploy model)
  - `docs/2026-06-29-plugin-bundled-default-credential-design.md` (bundled TMDB key → connect-services step now optional)

## Summary

A self-hosted nama instance currently has no sanctioned way to create its first
admin (only the temporary `apps/server/src/db/create-user.ts` CLI) and no
onboarding once that admin signs in (only a placeholder `/setup` route). This
design adds a single, unified first-install experience in two phases:

1. **Bootstrap** — a fresh install (zero users) prints a one-time **setup token**
   to the server console. The operator enters it on a public `/bootstrap` page to
   create the first admin account. This replaces and deletes `create-user.ts`.
2. **Onboarding wizard** — immediately after the admin's first sign-in, a
   full-screen wizard walks them through `Welcome` → `Connect services`.
   Configuring the **TMDB** metadata key is required (the app cannot render media
   without it); everything else is optional. Completion sets a per-user
   `hasOnboarded` flag and redirects to the app.

The wizard is built as a **role-aware step registry** so a future non-admin user
onboarding reuses the same framework — adding member-facing steps is purely
additive, no rework.

## Goals

- Secure, scriptable first-admin creation for a single-tenant, self-hosted
  deployment (LAN / reverse-proxy).
- A guided wizard that guarantees the instance is functional (TMDB configured)
  before the admin lands in the app.
- A reusable, role-filtered onboarding framework.
- Delete the temporary `create-user.ts` provisioning path.

## Non-goals (deferred — see [Deferred work](#deferred-work))

- History import (Trakt sync, Letterboxd CSV).
- Preference seeding (pick genres / rate sample titles).
- MCP setup-guide step (the `SetupGuideModal` already exists under settings).
- Self-service **invite** flow (a new user setting their own password via an
  emailed token). Admin-driven creation of non-admin users already works via
  `POST /api/admin/users` and is kept working — see
  [self-registration](#closing-open-self-registration).
- Multi-tenant / multiple-admin deployments.

## Background — current state

Verified against the codebase on 2026-06-14:

| Area | Current state | Evidence |
| --- | --- | --- |
| First-admin creation | Temporary CLI reading env vars, writes `user`+`account`+`user_roles` directly. Marked "DELETE … once onboarding is in place." | `apps/server/src/db/create-user.ts` |
| First-run detection | None. Server boots, runs migrations, seeds roles. No "zero users" concept. | `apps/server/src/index.ts`, `apps/server/src/db/migrate.ts` |
| Onboarding UI | Placeholder route under the settings layout; JSDoc describes 5 intended steps; no implementation. | `apps/client/src/routes/_authenticated/_settings/setup.tsx` |
| Auth | Better Auth (email/password enabled) + custom session injecting `permissions`. Single role per user. `role_admin` (systemSlug `admin`) grants `ALL_PERMISSIONS`. | `apps/server/src/auth/internal/config.ts`, `apps/server/src/db/seed.ts`, `apps/server/src/db/schema/auth/roles.ts` |
| Route guard | `_authenticated` `beforeLoad` redirects to `/auth/login` when no session. | `apps/client/src/routes/_authenticated/route.tsx` |
| Public pre-session config | Unauthenticated `GET /api/config/public` returns `{ emailEnabled, mcpEndpointUrl, mcpScopes }`. | `apps/server/src/api/procedures/config.ts` |

### Key discovery — TMDB is a shared credential, not a user connection

This materially shaped the design. **TMDB's manifest declares
`auth: { kind: "none" }` with every capability at `scope: "global"` and
`poolable: true`.** Its API key lives in `sharedCredentialsSchema` (`apiKey`,
`x-secret`), is admin-configured, and is stored encrypted in the
`plugin_shared_credentials` table via `sharedCredentialsService`
(`apps/server/src/plugin-runtime/internal/shared-credentials.ts`).

Consequently:

- **The connections list excludes TMDB.** `toAvailablePluginSummary` in
  `apps/server/src/connections/service.ts` returns `null` for any plugin with no
  user-scoped capabilities (`if (userScoped.length === 0) return null`). So TMDB
  never appears in `GET /api/connections/available` and is **not** configured via
  `ConnectionModal` / `serviceConnections`.
- TMDB is configured through the **admin plugins** API:
  `POST /api/plugins/tmdb/shared-credentials` (body `{ label, value: { apiKey } }`)
  and verified ephemerally via
  `POST /api/plugins/tmdb/shared-credentials/test-ephemeral` (body `{ value: { apiKey } }`).
  Both require the `admin:plugins` permission, which the bootstrap admin has.
- **"TMDB is configured"** ⇔ `sharedCredentialsService.countEnabled("tmdb") > 0`.

The connect-services step therefore has two distinct regions (see
[Connect-services step](#connect-services-step)): a **required** admin
shared-credential region (TMDB) and an **optional** user-connection region
(reusing the existing available-plugins + `ConnectionModal` flow).

## States and routing

The system derives two pieces of state:

- **`needsBootstrap`** — server-computed, `true` when the `user` table is empty.
  Exposed by extending the existing public config payload. Because the flag only
  ever transitions true→false (when the first user is created) and never back,
  the server caches `false` once it observes a user via a module-level latch and
  short-circuits the per-request `SELECT id FROM user` on subsequent calls.
- **`hasOnboarded`** — per-user boolean column on the Better Auth `user` table,
  surfaced on the session user object.

Routing guards (TanStack Router `beforeLoad`):

1. **Root** (`apps/client/src/routes/__root.tsx`): `__root` has **no `beforeLoad`
   today** and `RouterContext` is `{ queryClient, session }` (session is `null`
   until `_authenticated` populates it). This design adds a `beforeLoad` to
   `__root` that resolves the public config through React Query —
   `queryClient.ensureQueryData({ queryKey: ["public-config"], queryFn, staleTime:
   Infinity })`. `needsBootstrap` only ever transitions true→false exactly once per
   install and never back, so an effectively-immortal `staleTime` is correct and
   avoids a network call on every navigation. If `needsBootstrap` and the current
   route is not `/bootstrap`, `redirect({ to: "/bootstrap" })`. This gate runs for
   every route, including `/auth/*`, so a fresh install funnels everyone to
   bootstrap. (`RouterContext` is **not** extended — the value lives in the query
   cache, read via `queryClient`, which is already in context.)
2. **`_authenticated`** (`.../_authenticated/route.tsx`): after the existing
   session check, if `session.user.hasOnboarded === false` and the route is not
   `/setup`, `redirect({ to: "/setup" })`.

Route changes:

- New **public** route `apps/client/src/routes/bootstrap.tsx` (outside
  `_authenticated`, full-screen, no app shell).
- Move the wizard from `_authenticated/_settings/setup.tsx` →
  `_authenticated/setup.tsx` so it renders full-screen without the settings
  sidebar/chrome. (Its `beforeLoad` still inherits the `_authenticated` session
  guard but is exempt from the `hasOnboarded` redirect.)

State → destination:

| `needsBootstrap` | session | `hasOnboarded` | Destination |
| --- | --- | --- | --- |
| true | — | — | `/bootstrap` |
| false | none | — | `/auth/login` |
| false | yes | false | `/setup` |
| false | yes | true | requested route / `/` |

## Phase 1 — Bootstrap (setup token → first admin)

### Setup token lifecycle

- On boot, if `needsBootstrap` is true and no **active** token row exists, generate
  a 32-byte token (`crypto.randomBytes(32).toString("base64url")`), store **only
  its hash** (`sha256`) in a new `app_bootstrap` table, and print the **plaintext**
  token to the server console in an unmistakable boxed banner (via `consola`).
- The plaintext is **never persisted and never returned over HTTP** — it exists
  only in the boot log. Re-printed on every boot while the instance is still in
  bootstrap state so the operator can always recover it (e.g. `docker logs`).
- When the first admin is created, the token row is marked consumed
  (`consumedAt`) inside the same transaction. Bootstrap is then permanently
  closed (`needsBootstrap` is false because a user exists).

### Data model — `app_bootstrap`

New table (own schema file
`apps/server/src/db/schema/app/bootstrap.ts`, wired into
`apps/server/src/db/schema/index.ts`):

```ts
export const appBootstrap = sqliteTable("app_bootstrap", {
  id: text("id").primaryKey(),            // single-row sentinel, e.g. "bootstrap"
  tokenHash: text("token_hash").notNull(),
  createdAt: integer("created_at").notNull(),
  consumedAt: integer("consumed_at"),     // null until claimed
});
```

A migration is generated with the `db:generate` script (drizzle-kit; run via the
project's `vp run db:generate` from `apps/server`) and applied automatically at
boot by `runMigrations()`.

### Shared user-creation helper

Extract the direct-insert technique currently in `create-user.ts` into a single
reusable helper so bootstrap, the dev seed, the **existing admin user-creation
endpoint** (see [self-registration](#closing-open-self-registration)), and any
future invite flow share one code path:

```ts
// apps/server/src/auth/internal/create-user.ts (server-internal, not barrel-exported)
createUserWithRole(input: {
  email: string; password: string; name: string; roleId: string;
}): Promise<{ userId: string }>
```

It mirrors what Better Auth's `sign-up/email` writes — `providerId: "credential"`,
`accountId = userId`, `password = await hashPassword(password)` from
`better-auth/crypto` — inside one transaction (`user` + `account` + `user_roles`).
This avoids loading the full `betterAuth({...})` instance and its JWKS side effect
for the create path, exactly as the current CLI documents.

`seedRoles()` already guarantees `role_admin` exists before any user is created.

### Claim endpoint and flow

`needsBootstrap` is surfaced by extending the existing `GET /api/config/public`
payload (the root guard already fetches it pre-session) — there is no separate
status endpoint, since no other consumer needs one.

A new **public** Hono sub-app `bootstrapApp` mounted at `/api/bootstrap` (no
`requireSession`):

- `POST /api/bootstrap/claim` with body `{ token, email, password, name }`
  (`password` must be 8–256 characters and contain at least one letter and one
  digit, enforced by the shared `passwordSchema` in `@nama/shared/auth` and
  reused by the admin user-create endpoint; the 8-char floor + alphanumeric rule
  is a deliberate net entropy reduction from the original 12-char length-only
  policy, accepted as a usability tradeoff. The max caps the input so an
  over-long value cannot inflate the scrypt hashing cost):
  1. Inside a single transaction, assert the `user` table is empty. If not, throw
     `409 bootstrap.already_completed` ("This server is already set up").
  2. Look up the `app_bootstrap` row; constant-time compare `sha256(token)` to the
     stored hash. On mismatch throw `400 bootstrap.invalid_token`.
  3. Call `createUserWithRole({ ...body, roleId: "role_admin" })`.
  4. Mark the token row `consumedAt = now`.
  5. Return `{ ok: true }`.
- The client then calls `authClient.signIn.email({ email, password })` to
  establish the session, and navigates to `/setup`.

The **in-transaction zero-users assertion** is the core safety property: even
under concurrent requests, exactly one first admin can be created, and the token
is required to set the admin role.

### Closing open self-registration

Set `emailAndPassword.disableSignUp: true` in the Better Auth config
(`apps/server/src/auth/internal/config.ts`). This keeps **sign-in** enabled while
closing the public `POST /api/auth/sign-up/email` route. Rationale:

- Without it, an attacker could POST directly to the Better Auth sign-up route on
  a fresh install, creating a role-less user that flips `needsBootstrap` to false —
  a denial-of-setup that locks the legitimate operator out of `/bootstrap`. The
  client-side route guard does not protect the raw HTTP endpoint.
- With sign-up disabled, the **only** path to the first user is
  `POST /api/bootstrap/claim` (token-gated, role-granting, atomic). Future users
  arrive via an admin invite flow (deferred).

**`disableSignUp` blocks every caller of the sign-up endpoint — including
server-side `auth.api.signUpEmail`, which invokes the same gated handler.** Two
existing call sites therefore must move to `createUserWithRole`, or they break:

- `seedDevUser` (`apps/server/src/db/seed.ts`) — dev-only admin seed.
- **`POST /api/admin/users`** (`adminUsersApp`, `apps/server/src/api/procedures/users.ts`)
  — the already-shipping admin endpoint that creates member/viewer users. It
  already forbids assigning the admin role, so it maps directly onto
  `createUserWithRole({ ..., roleId })`. This is a real, current code path; the
  bootstrap is the *first-admin* path, but admin-driven creation of additional
  (non-admin) users continues to work via this endpoint. (The multi-user **invite**
  flow — self-service signup via emailed token — is what remains deferred.)

The client `/auth/register.tsx` route is neutralized in v1 to show an
"invite-only" message (full invite UI is deferred); with the bootstrap guard
active it is unreachable on a fresh install anyway.

### `create-user.ts` removal

Delete `apps/server/src/db/create-user.ts` and the temporary
`.github/workflows/create-user.yml` that invokes it. Bootstrap supersedes both.

## Phase 2 — Onboarding wizard

### Role-aware step registry (the framework)

Onboarding is an **ordered registry of step descriptors**, not a hard-coded
sequence. This is the extensibility seam for future non-admin onboarding.

The descriptor predicates depend on the user's **role** and on server-only state
(whether TMDB is configured). Neither is available on the client session — the
`customSession` callback returns only `{ session, user, permissions }`, not the
role. **So the registry and its predicates live on the server**, and the client
receives already-resolved, presentational step data. This is the source of truth:

```ts
// Server-side (apps/server/src/onboarding or api/procedures/onboarding.ts)
interface OnboardingStepContext {
  role: UserRoleInfo;          // resolved via loadUserRole(userId)
  tmdbConfigured: boolean;     // sharedCredentialsService.countEnabled("tmdb") > 0
}
interface OnboardingStepDescriptor {
  id: string;                  // "welcome" | "connect-services"
  title: string;
  appliesTo(ctx: OnboardingStepContext): boolean;   // role filter
  isRequired(ctx: OnboardingStepContext): boolean;
  isComplete(ctx: OnboardingStepContext): boolean;
}
```

`GET /api/onboarding/state` builds the context (`loadUserRole` + the TMDB count),
evaluates every descriptor, and returns the resolved list:

```jsonc
{ "hasOnboarded": false,
  "steps": [ { "id": "welcome", "title": "Welcome", "applies": true, "required": false, "complete": true },
             { "id": "connect-services", "title": "Connect services", "applies": true, "required": true, "complete": false } ] }
```

The **client** keeps only a presentational map `id → { Component, title }`
(`step-registry.ts`), renders the steps the server marked `applies`, and disables
**Finish** while any server-marked `required && !complete` step remains. The client
never evaluates role logic. Adding a member-facing step later means appending a
server descriptor whose `appliesTo` matches non-admin roles plus a client
component keyed by its `id` — no shell changes, no client role logic.

v1 registry: `welcome`, `connect-services` (both `appliesTo: admin`; the
framework is role-aware but only the admin path is wired in v1).

Because the `_authenticated` guard funnels **every** `hasOnboarded === false`
user to `/setup`, a non-admin member (detectable as holding no `admin:*`
permission) lands on the wizard with zero applicable steps in v1. The wizard
handles this by rendering a brief "you're all set — nothing to configure" state
with a single Finish button (reusing the complete mutation) instead of an empty,
step-less shell. No role is threaded through the session for this; the client
simply branches on the server-resolved applicable-step count being zero.

### Welcome step

Static, informational, always complete. Explains what nama is and that it exposes
an MCP endpoint for clients like Claude/Cursor. No inputs.

### Connect-services step

Two regions, reflecting the [TMDB discovery](#key-discovery--tmdb-is-a-shared-credential-not-a-user-connection):

**Required — TMDB metadata key (admin shared credential).**
- A form bound to TMDB's `sharedCredentialsSchema` (a single `apiKey`, `x-secret`).
- "Test key" calls `POST /api/plugins/tmdb/shared-credentials/test-ephemeral`
  (`{ value: { apiKey } }`) → green/red result without persisting.
- "Save" calls `POST /api/plugins/tmdb/shared-credentials`
  (`{ label: "Default", value: { apiKey } }`).
- Step `isComplete` ⇔ `tmdbConfigured` (≥1 enabled TMDB shared credential).
- Includes a link to TMDB's API-key page and a one-line explanation of why it is
  required.

**Optional — personal service connections.**
- Reuses `GET /api/connections/available` and the existing `ConnectionModal`
  (`apps/client/src/features/connections/`) to let the admin link user-scoped
  services (Plex, Jellyfin, Trakt, Seerr, …).
- Entirely skippable; presence/absence never blocks Finish.

### Completion

- `POST /api/onboarding/complete`: server re-derives required-step completion
  (authoritative TMDB check — never trust the client) and, only if satisfied, sets
  `user.hasOnboarded = true`. If not satisfied, throws
  `400 onboarding.requirements_unmet`.
- `GET /api/onboarding/state` → `{ hasOnboarded, steps: [{ id, applies, required,
  complete }] }`, used by the wizard to render progress and gate Finish.
- On success the client invalidates the session query and navigates to `/`.

## Data model summary (migrations)

One generated drizzle migration covering:

1. `user.has_onboarded` — `integer("has_onboarded", { mode: "boolean" })
   .notNull().default(false)` on the Better Auth `user` table
   (`apps/server/src/db/schema/auth/auth.ts`). Existing rows backfill to `false`.
   On a fresh install the bootstrap admin is the only pre-existing user and should
   onboard. **Behavior change for upgrades:** an existing deployment that already
   created an admin via the old `create-user.ts` will see that admin
   force-redirected to `/setup` on next load — defensible (they should confirm
   TMDB is configured) but explicitly called out, with a test (below).
2. New `app_bootstrap` table (above).

`hasOnboarded` is also declared in Better Auth's `user.additionalFields`, with
**`input: false`** so it can never be set through Better Auth's create/update
input (defaults are `input: true`). This is load-bearing: the flag must flip
only through the server-authoritative `POST /api/onboarding/complete` (or a direct
DB write), never client-supplied — otherwise the TMDB-required gate is trivially
bypassed:

```ts
user: {
  additionalFields: { hasOnboarded: { type: "boolean", input: false, defaultValue: false } },
}
```

To get `session.user.hasOnboarded` **typed** in the guard, the `customSession`
plugin must be called as `customSession(fn, options)` (the one-arg form does not
infer additional fields). The client then reads `session.user.hasOnboarded` in the
`_authenticated` guard with no extra request.

## API surface

| Method + path | Auth | Purpose |
| --- | --- | --- |
| `GET /api/config/public` | none | Extended to include `needsBootstrap`. Root guard reads this. |
| `POST /api/bootstrap/claim` | none (self-closing) | Create first admin from token. |
| `GET /api/onboarding/state` | session | Resolved per-step flags (role computed server-side via `loadUserRole`) + `hasOnboarded`. |
| `POST /api/onboarding/complete` | session | Guarded flip of `hasOnboarded`. |
| `POST /api/plugins/tmdb/shared-credentials` | `admin:plugins` | **Existing.** Save TMDB key. |
| `POST /api/plugins/tmdb/shared-credentials/test-ephemeral` | `admin:plugins` | **Existing.** Test TMDB key. |
| `GET /api/connections/available` | `account:connections` | **Existing.** Optional connections list. |

New server modules:

- `apps/server/src/api/procedures/bootstrap.ts` → `bootstrapApp`, mounted in
  `apps/server/src/api/router.ts` at `/bootstrap`.
- `apps/server/src/api/procedures/onboarding.ts` → `onboardingApp`, mounted at
  `/onboarding`.
- Token issuance lives in a small `apps/server/src/auth/internal/bootstrap.ts`
  service (issue/verify/consume), called from `bootstrap()` in
  `apps/server/src/index.ts` after `runMigrations()` and from the claim handler.

Request/response schemas (zod) live in `packages/shared/src/onboarding/` and
`packages/shared/src/bootstrap/` per the shared-package conventions, validated
with `@hono/zod-validator`.

## Client structure

New feature folder `apps/client/src/features/onboarding/` (per
`frontend-feature-architecture`):

- `components/` — `bootstrap-page.tsx`, `onboarding-wizard.tsx` (shell + stepper),
  `steps/welcome-step.tsx`, `steps/connect-services-step.tsx`,
  `steps/tmdb-key-form.tsx`.
- `lib/` — `step-registry.ts` (presentational only: `id → { Component, title }`; the
  authoritative descriptor list + predicates live server-side), `fetchers.ts`,
  `query-keys.ts`, `types.ts`.
- `hooks/` — `use-needs-bootstrap.ts` (reads `needsBootstrap` off the
  public-config query), `use-onboarding-state.ts`, `use-claim-bootstrap.ts`,
  `use-complete-onboarding.ts`.
- `index.ts` — barrel.

Routes: `routes/bootstrap.tsx` (public) and the relocated
`routes/_authenticated/setup.tsx` render these components. The optional
connections region imports the existing `ConnectionModal` rather than
re-implementing it.

## Error handling

| Condition | Surface |
| --- | --- |
| Invalid / missing token | Inline form error on `/bootstrap` (`bootstrap.invalid_token`). |
| Server already set up (race or stale tab) | `/bootstrap` shows "Already set up — go to login" (`bootstrap.already_completed`). |
| TMDB test/save failure (bad key, upstream down) | Inline result in the TMDB form; step stays incomplete; Finish stays disabled. |
| Finish attempted with TMDB unconfigured | Server returns `onboarding.requirements_unmet`; wizard keeps Finish disabled (defense in depth). |
| Network errors | Standard query error boundaries already used across features. |

All server errors use the unified `{ code, devMessage, requestId }` envelope from
`diagnostics/http-errors`.

## Testing (intent-encoding)

**Server**
- `needsBootstrap` is true with zero users and false after one exists.
- Boot issues exactly one token and stores only its hash; re-issues nothing while
  a non-consumed row exists; re-prints on subsequent boots.
- `claim` with a valid token creates `user` + `account` + `user_roles(role_admin)`
  and consumes the token; the new admin resolves `ALL_PERMISSIONS`.
- `claim` is rejected once any user exists (`already_completed`) — asserts the
  setup cannot be re-run / hijacked.
- `claim` with a wrong token is rejected and creates nothing — asserts the token
  actually gates admin creation.
- `emailAndPassword.disableSignUp` blocks `POST /api/auth/sign-up/email` — asserts
  the open-signup denial-of-setup hole is closed.
- `onboarding/complete` flips `hasOnboarded` only when TMDB has ≥1 enabled shared
  credential; otherwise `requirements_unmet` — asserts the "app is functional"
  guarantee is enforced server-side, not just in the UI.
- `POST /api/admin/users` still creates a member/viewer after `disableSignUp` is
  set — asserts the existing admin user-creation path survives the sign-up
  closure (regression guard for the `createUserWithRole` switch).
- `hasOnboarded` cannot be set through any Better Auth create/update input
  (`input: false`) — asserts the server-authoritative gate can't be bypassed by a
  client-supplied flag.

**Client**
- Root guard redirects to `/bootstrap` when `needsBootstrap`, and not when false.
- `_authenticated` guard redirects to `/setup` when `hasOnboarded === false`, and
  not when true; `/setup` itself is exempt.
- Wizard Finish is disabled until the TMDB step reports complete.
- The server `onboarding/state` descriptor evaluation omits admin-only steps for a
  member-role context (locks in the role-aware reuse contract before member
  onboarding exists).
- A pre-existing user (created before the migration) is redirected to `/setup`
  once `hasOnboarded` backfills to `false` — asserts the upgrade behavior change is
  intentional and observable.

## Deferred work

Tracked in a follow-up issue (create on merge): history import, preference
seeding, MCP setup-guide step, and the self-service **invite** flow (emailed
token lets a new user set their own password; replaces the neutralized
`/auth/register`). The step registry and `createUserWithRole` helper are the
extension points for these.

### Implemented in issue #579

- **MCP setup-guide step** — added as a third admin onboarding step
  (`id: "mcp-setup"`, optional, always complete). Shows the MCP endpoint URL
  with a copy button and a button that opens the existing `SetupGuideModal`.
  Server descriptor in `api/procedures/onboarding.ts`; client component at
  `features/onboarding/components/steps/mcp-setup-step.tsx`.
- **Self-service link-invite flow** — implemented separately in issue #659
  (`api/procedures/invites.ts`, `features/admin-users`, `routes/auth/invite.$token.tsx`).
  History import and preference seeding remain deferred (no backend
  infrastructure exists yet).

## Open questions

1. **Token display ergonomics** — console banner only, or also write the token to
   a file (e.g. `data/bootstrap-token.txt`) for operators who can't easily read
   container logs? (Default: console only; revisit if painful.)
2. **`/auth/register` in v1** — neutralize to an "invite-only" message (proposed)
   vs. remove the route entirely until invites land. (Default: neutralize.)
3. **Welcome-step "complete" semantics** — implicitly complete on view vs. require
   an explicit "Get started" click before Finish is allowed. (Default: implicit.)

## File-change checklist

**Server**
- `db/schema/app/bootstrap.ts` (new), wired into `db/schema/index.ts`.
- `db/schema/auth/auth.ts` — add `has_onboarded`.
- `drizzle/<generated>.sql` — migration for both schema changes.
- `auth/internal/create-user.ts` (new shared helper); `auth/internal/bootstrap.ts`
  (token service); `auth/internal/config.ts` — `disableSignUp`, `additionalFields`.
- `auth/index.ts` — barrel exports for the new service surface as needed.
- `db/seed.ts` — `seedDevUser` switched to `createUserWithRole`.
- `api/procedures/users.ts` — `POST /` switched from `auth.api.signUpEmail` to
  `createUserWithRole` (otherwise `disableSignUp` breaks admin user creation).
- `db/create-user.ts` — **delete**; `.github/workflows/create-user.yml` — **delete**.
- `index.ts` — issue/print token after `runMigrations()`.
- `api/procedures/bootstrap.ts`, `api/procedures/onboarding.ts` (new) — the latter
  hosts the server-side step descriptor registry + context builder
  (`loadUserRole` + TMDB count); `api/procedures/config.ts` — add `needsBootstrap`;
  `api/router.ts` — mount both.

**Shared**
- `packages/shared/src/bootstrap/` and `packages/shared/src/onboarding/` —
  schemas/types + `package.json` subpath exports. `PublicConfig`
  (`packages/shared/src/users/types.ts`) extended with `needsBootstrap`; while
  there, fix its stale JSDoc that still says `GET /api/public-config`.

**Client**
- `features/onboarding/**` (new).
- `routes/bootstrap.tsx` (new); `routes/_authenticated/_settings/setup.tsx` →
  `routes/_authenticated/setup.tsx` (move + implement; delete the stale 5-step
  JSDoc the placeholder carries so it doesn't contradict this design).
- `routes/__root.tsx` — `needsBootstrap` guard; `routes/_authenticated/route.tsx`
  — `hasOnboarded` guard.
- `routes/auth/register.tsx` — neutralize to invite-only message.

**Docs / versioning**
- This spec.
- Changeset: `@nama/server` minor + `@nama/client` minor (new end-user feature).
- Follow-up issue for deferred work.

## Implementation notes (as built)

Refinements made during implementation, all consistent with the design's intent:

- **One creation primitive, three callers.** `auth/internal/create-user.ts`
  exports a transaction-aware `insertCredentialUserTx(tx, { email, password,
  name, roleId?, emailVerified? })` that writes the `user` + credential `account`
  (+ optional `user_roles`) rows. `createUserWithRole`/`createUser` wrap it in
  their own transaction, and `claimBootstrap` calls it inside its
  zero-users-asserting transaction — so the better-auth credential account shape
  lives in exactly one place (resolves review note on the inlined third copy).
  The admin user-creation endpoint (`POST /api/admin/users`) still uses the role
  path when a `roleId` is supplied and the no-role path when omitted, preserving
  its prior semantics under `disableSignUp`.
- **Bootstrap service surface.** Token issuance/verification/consumption lives in
  `auth/internal/bootstrap.ts` (`needsBootstrap`, `ensureBootstrapToken`,
  `claimBootstrap`) and is exposed through `auth/service.ts` → the `auth` barrel
  (the adapter never imports `internal/`). `claimBootstrap` asserts zero users,
  verifies the token (cheap hash check **before** the expensive scrypt password
  hash, so a bad token never pays the scrypt cost), creates the admin via
  `insertCredentialUserTx`, and consumes the token — all in one transaction.
- **Bootstrap hardening (review-driven).** Token verification additionally
  requires `consumedAt === null`, so a spent token from the boot log can never be
  replayed even if every user row were later deleted (defense-in-depth behind the
  zero-users gate). The bootstrap admin is created `emailVerified: true` — reading
  the console token proves control of the server. After a successful claim the
  client invalidates the cached `public-config` query so the now-`false`
  `needsBootstrap` is refetched, otherwise the immortal `staleTime` would bounce
  the new admin back to `/bootstrap` until a full reload.
- **Token re-issue on restart.** Because only the SHA-256 hash is stored, the
  plaintext is unrecoverable after a process restart. So on a restart with a
  stale non-consumed row, `ensureBootstrapToken` mints a **fresh** token and
  overwrites the stored hash (the previously printed token stops working). This
  satisfies the "recover the token from the boot log" goal against hash-only
  storage rather than literally re-printing the same token.
- **`hasOnboarded` read.** `GET /api/onboarding/state` reads the flag via a small
  `auth` barrel accessor `isUserOnboarded(userId)` rather than the Hono context
  session, because the context session is not typed with the additional field.
  The flag is still flipped only by the server-authoritative `markUserOnboarded`.
- **`customSession` inference.** The Better Auth config was restructured to the
  options-extraction pattern (`const options = {...} satisfies BetterAuthOptions`;
  `customSession(fn, options)`) so `session.user.hasOnboarded` is typed.
- **Guards fail open.** The `__root` and `/bootstrap` guards swallow a
  public-config fetch error (treating it as "do not funnel") so a transient
  backend outage degrades gracefully, matching the existing `/auth` and
  `/_authenticated` guards instead of blanking every route.
- **Shared validation.** The `/bootstrap` form validates with the shared
  `bootstrapClaimSchema` (via its per-field `.shape`) through TanStack Form's
  Standard Schema support — the same schema the server validates with, no
  hand-written validators. The `token` field enforces the exact issued shape
  (43 base64url chars) so typos and truncated copies are rejected client-side
  before the round-trip.
- **Auth shell reuse.** The bootstrap page reuses the existing auth visual shell
  via a new `AuthShell` component extracted from `AuthLayout` (a pure refactor),
  so `/bootstrap` is a visual sibling of `/auth/login`.
- **Warm the home feed on completion.** Completing onboarding now
  fire-and-forget triggers the `host.catalog.discover_snapshot` job so trending
  and new-release content lands within seconds instead of waiting for the next
  scheduled run. The warm never fails completion. The client renders a brief
  warming empty state and polls until the home feed has content, backing off
  5s → 10s → 20s → cap 30s so a cold TMDB cache does not get hammered.
- **Architecture boundaries.** The new `features/onboarding/` client feature and
  `db/schema/app/` server schema namespace are registered as their own fallow
  zones (`client-feat-onboarding`, `server-schema-app`) with allow-rules matching
  the deps they actually use (auth/connections/settings-connections + shared on
  the client; auth-internal → schema-app on the server), so the boundary gate
  passes the same way every other feature/schema does.
- **Cleanup.** `.github/workflows/create-user.yml` did not exist; the only
  `create-user` script reference (`db:create-user`) lived in the root
  `package.json` and was removed alongside deleting `db/create-user.ts`.

Verified end-to-end in a browser against a fresh zero-user install: boot token
banner → `/bootstrap` funnel → token claim (admin + `role_admin` created, token
consumed) → session → `/setup` wizard → welcome + connect-services steps with
Finish disabled until TMDB is configured. Plus `vp check` clean, the fallow
boundary/quality gate green, and `vp test` green (2814 tests).
