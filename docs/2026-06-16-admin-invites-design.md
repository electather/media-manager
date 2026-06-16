# Admin Invites

## Goal

Implement the real admin invite feature, replacing the client-side mock store
(`apps/client/src/features/admin-users/lib/invites-mock.ts`). An admin generates
a shareable invite link bound to a role; a stranger opens the link, registers an
account, and is granted that role. This is the sanctioned self-registration path
while public signup is disabled.

Closes #659 (and the duplicate #658).

## Constraints

- Server: Hono RPC + Drizzle ORM (SQLite/libSQL) + Better Auth 1.6.x.
- Public signup is disabled globally (`disableSignUp: true`). Account creation
  exists only via admin `POST /admin/users` and the bootstrap claim. The accept
  flow must create accounts via a direct internal call, never the disabled
  public sign-up endpoint.
- No email delivery infrastructure. `sendEmail` no-ops when
  `EMAIL_PROVIDER_CONFIGURED=false` and throws when true (no provider wired).
- Permissions are enforced server-side via `requirePermission(PERMISSIONS.ADMIN_USERS)`.
- Shared zod schemas live in `packages/shared/src`. The typed `hc` client infers
  endpoint types from the server's `AppType`.
- Follow the existing admin route pattern (`apps/server/src/api/procedures/users.ts`)
  and the flat feature layout for `admin-users`.

## Non-goals

- Email invites and any email-provider wiring (Resend/SES/SMTP). The data model
  reserves columns for them, but the email tab and delivery are deferred until a
  provider lands.
- Hashed one-time tokens. Link invites are deliberately re-displayable, so the
  code is stored in plaintext (see §3). Hashed tokens are appropriate for future
  email invites, which are never re-displayed.
- Audit logging beyond the `revokedAt` soft-delete column.

The public preview/accept endpoints **do** get the standard `publicIpRateLimit`
wrapper (in-scope, §4.2). Code entropy (~93 bits) defends against *guessing* a
code; the rate limiter defends against hammering a *known* code and against
scrypt / mass-user-creation abuse, which entropy does not.

---

## 1. Decisions (settled during design)

1. **Link invites only.** Drop/hide the email tab. Everything works end-to-end in
   production — the admin copies a link and shares it manually. No dead "email
   sent" UX.
2. **Code is the token.** The 18-char invite code is the bearer secret and the URL
   token. Links point at `/auth/invite/<code>`, matching the existing route and
   fixing the `/invite/<code>` vs `/auth/invite/$token` mismatch.
3. **Plaintext code storage.** `invite-row.tsx` re-displays the code so an admin
   can re-copy the link; the code is therefore stored retrievably, scoped by
   expiry + max-uses + revoke.
4. **Multi-use links.** Keep `maxUses` + `uses` (matches the existing drawer UI).
   Acceptance atomically guards the use count.
5. **Accepter supplies email.** Link invites bind no email. The accepter types
   name + email + password; the server enforces the existing `user.email` unique
   constraint and rejects already-registered emails.

---

## 2. Data model

New table `invites` (`apps/server/src/db/schema/auth/invites.ts`), migration
`apps/server/drizzle/0008_*.sql` generated via `bun run db:generate` and applied
with `bun run db:migrate`. (`db:generate` emits a random slug; rename to match the
descriptive convention used by `0005`–`0007`, e.g. `0008_invites.sql`, if the
generated name is not meaningful.)

```
invites
  id          text pk
  code        text not null unique          -- bearer token + URL token (~93 bits)
  roleId      text not null -> roles.id      -- role granted on accept
  invitedBy   text not null -> user.id       -- admin who created it
  createdAt   int  timestamp_ms not null
  expiresAt   int  timestamp_ms not null
  maxUses     int  not null default 1
  uses        int  not null default 0        -- atomic-incremented on accept
  revokedAt   int  timestamp_ms null         -- soft revoke
  email       text null                      -- reserved for future email invites
  kind        text not null default 'link'   -- reserved; only 'link' active now
```

`expired` is **not stored** — it is computed at read time:
`expiresAt < now OR uses >= maxUses OR revokedAt != null`.

## 3. Shared schemas (`packages/shared/src/invites/`)

```
createInviteSchema = z.object({
  roleId:    z.string().min(1),
  expiresAt: z.number().int().positive(),   // ms timestamp, must be in the future
  maxUses:   z.number().int().min(1),
})

acceptInviteSchema = z.object({
  name:     z.string().min(1),
  email:    z.email(),
  password: passwordSchema,                  // reuse packages/shared/src/auth/password
})
```

DTOs:

- `AdminInviteDTO` — mirrors the client `AdminInvite` type, plus a server-built
  `url` (`/auth/invite/<code>`) and computed `expired`. `revokedAt` is **not**
  exposed (the list already excludes revoked rows).
- `InvitePreviewDTO` — `{ roleName, expiresAt }` only. Returned to the
  unauthenticated accepter; it must not leak `invitedBy`, `code` internals, or
  other invites.

These schemas are imported server-side for `zValidator` and client-side for type
safety.

## 4. Backend

### 4.1 Admin subapp — `adminInvitesApp` at `/admin/invites`

Middleware: `requireSession` + `requirePermission(PERMISSIONS.ADMIN_USERS)`.
Registered in `apps/server/src/api/router.ts`. Mirrors `adminUsersApp`.

- `POST /admin/invites` (`zValidator("json", createInviteSchema)`)
  - **Reuse `requireAssignableRole`** (currently module-private in `users.ts`).
    It rejects the system Admin slug **and** any role holding an admin-tier
    permission (#576) — guarding on capability, not just slug. An invite must not
    become a privilege-escalation hole that the `users` endpoints already close,
    so it must run the *full* guard, not a slug-only copy. Extract
    `requireAssignableRole` (and its helper `requireRole`) into a shared module so
    both `users.ts` and `invites.ts` import one implementation (see §8).
  - Generate an 18-char code, insert the row, return `AdminInviteDTO` with `url`.
- `GET /admin/invites`
  - List non-revoked invites, newest first, with computed `expired`/`uses`.
- `POST /admin/invites/:id/resend`
  - Reset `expiresAt` to `now + TTL`; clear nothing else. (Link invites have no
    email to re-send; this extends a still-shareable link.)
- `DELETE /admin/invites/:id`
  - Set `revokedAt = now` (soft revoke). List excludes revoked rows.

### 4.2 Public subapp — `invitesApp` at `/invites`

No admin/session middleware — accepters are unauthenticated. Wrapped in
`publicIpRateLimit`, matching every other public group in `router.ts`
(`/bootstrap/*`, `/public/*`, `/config/public/*`). Registered in `router.ts`.

- `GET /invites/:code`
  - Look up by code. Return `InvitePreviewDTO` when active; `404` when missing;
    `410` when expired / exhausted / revoked.
- `POST /invites/:code/accept` (`zValidator("json", acceptInviteSchema)`)
  - Runs entirely inside **one `db.transaction`** so a later failure rolls back
    the use-count increment (no silently-burned use):
    1. **Atomic use guard** (single statement, race-safe under SQLite's
       single-writer snapshot isolation):
       ```
       UPDATE invites
          SET uses = uses + 1
        WHERE code = ?
          AND uses < maxUses
          AND expiresAt > now
          AND revokedAt IS NULL
       ```
       0 rows changed ⇒ throw → `410 Gone` (consumed/expired/revoked between
       preview and accept).
    2. **Unique-email check** within the txn (mirror `requireUniqueEmail` in
       `users.ts`): duplicate ⇒ throw → `409` with an "account exists — log in"
       body. (Checked before the insert so the failure is a clean 409, not a raw
       UNIQUE-constraint error; the txn rolls back the increment from step 1.)
    3. **Create the account** via `insertCredentialUserTx(tx, { email, password,`
       `name, roleId, emailVerified: true })` from
       `apps/server/src/auth/internal/create-user.ts`. This is the same primitive
       `claimBootstrap` uses inside its own transaction, so it composes with our
       `tx`. It writes the `user` + credential `account` rows directly (bypassing
       the disabled public sign-up endpoint) in the exact shape Better Auth's
       `sign-in/email` reads. `emailVerified: true` because holding a valid invite
       link is the proof of access (note: `createUserWithRole` is **not** used —
       it opens its own transaction and cannot set `emailVerified`).
  - Returns `{ ok: true, userId }` — **no server-side session** (none of the
    existing creators, including `claimBootstrap`, mint one).
  - **Sign-in is client-side.** On a successful accept the client immediately
    calls Better Auth email sign-in with the just-submitted email + password
    (the credential `account` row was written precisely for `sign-in/email` to
    look up), then redirects to `/setup`. See §6.

## 5. Client — replace the mock

- `lib/query-keys.ts` — add `adminInvitesKeys` (`all` / `list`).
- `lib/fetchers.ts` — `fetchInvites`, `createInvite`, `resendInvite`,
  `revokeInvite` (admin, typed `hc`), plus `fetchInvitePreview` and `acceptInvite`
  for the accept page.
- `hooks/` — `use-admin-invites.ts` (`useSuspenseQuery`), `use-create-invite.ts`,
  `use-resend-invite.ts`, `use-revoke-invite.ts` (mutations that invalidate
  `adminInvitesKeys` and the user-count query).
- Update consumers:
  - `components/invite-drawer.tsx` — call `useCreateInvite`; **hide the email
    tab**, keep the link tab (role + expiry + max-uses).
  - `components/invite-row.tsx` — resend/revoke via mutations; copy the
    server-returned `url`.
  - `components/users-page.tsx` — `useInvitesMock` → `useAdminInvites`.
  - `lib/user-predicates.ts` — pending count derived from the real invite list
    (active = not expired, not exhausted, not revoked).
- `inviteUrl` now resolves to `/auth/invite/<code>`.
- **Delete `lib/invites-mock.ts`.**

## 6. Accept page (`apps/client/src/routes/auth/invite.$token.tsx`)

Replace the stub:

- Query `GET /invites/:token` (the route param is the code).
- Invalid/expired ⇒ error state ("This invite is no longer valid").
- Valid ⇒ registration form (name / email / password), reusing the auth form
  primitives from the login/register routes.
- Submit ⇒ `acceptInvite` (creates the account). On success, **sign in** with the
  same email + password via Better Auth email sign-in (the server minted no
  session), then redirect to `/setup`. Surface `409` (account exists — link to
  login) and `410` (invite consumed/expired) inline.

## 7. Tests

Vitest + in-memory SQLite, mirroring
`apps/server/src/api/procedures/__tests__/users.role-guard.test.ts`
(`buildApp().request(...)`, seed in `beforeEach`):

- `POST /admin/invites` rejects the system Admin role (403) **and** a non-system
  role that grants an admin-tier permission (403) — exercising both arms of
  `requireAssignableRole` (#576 escalation guard).
- Accept happy path: user + credential account created with `emailVerified=true`,
  role assigned, `uses` incremented by 1.
- Accept on expired / exhausted (`uses >= maxUses`) / revoked ⇒ 410.
- Accept with an already-registered email ⇒ 409, and `uses` is **not** consumed
  (transaction rollback — assert the row's `uses` is unchanged).
- Concurrent accept respects `maxUses` (atomic guard — only `maxUses` succeed).
- `GET /admin/invites` excludes revoked rows and reports computed `expired`.

The cited harness **mocks** `requireSession`/`requirePermission` to pass through,
so a real "403 without `ADMIN_USERS`" assertion can't be exercised there. The
admin subapp composes the *same* shared middleware as `adminUsersApp` (identical
`.use("*", requireSession).use("*", requirePermission(ADMIN_USERS))`); the guard
is covered by the existing users tests and is not re-tested here. The
invite-specific authorization logic that *is* re-tested is the role-assignability
rejection above.

## 8. File map

```
NEW  apps/server/src/db/schema/auth/invites.ts
NEW  apps/server/drizzle/0008_*.sql                      (generated)
NEW  apps/server/src/api/procedures/invites.ts           (adminInvitesApp + invitesApp)
NEW  apps/server/src/api/procedures/__tests__/invites.test.ts
NEW  packages/shared/src/invites/schemas.ts
NEW  packages/shared/src/invites/index.ts
EDIT apps/server/src/api/procedures/users.ts             (extract requireAssignableRole/requireRole to shared)
NEW  apps/server/src/api/procedures/<shared>/assignable-role.ts  (shared role guard; exact path per repo convention)
EDIT apps/server/src/api/router.ts                       (register both subapps; wrap /invites in publicIpRateLimit)
NEW  apps/client/src/features/admin-users/hooks/use-admin-invites.ts
NEW  apps/client/src/features/admin-users/hooks/use-create-invite.ts
NEW  apps/client/src/features/admin-users/hooks/use-resend-invite.ts
NEW  apps/client/src/features/admin-users/hooks/use-revoke-invite.ts
EDIT apps/client/src/features/admin-users/lib/query-keys.ts
EDIT apps/client/src/features/admin-users/lib/fetchers.ts
EDIT apps/client/src/features/admin-users/lib/user-predicates.ts
EDIT apps/client/src/features/admin-users/components/invite-drawer.tsx
EDIT apps/client/src/features/admin-users/components/invite-row.tsx
EDIT apps/client/src/features/admin-users/components/users-page.tsx
EDIT apps/client/src/routes/auth/invite.$token.tsx
DEL  apps/client/src/features/admin-users/lib/invites-mock.ts
```

## 9. Expansion path

- **Email invites:** activate the `email` + `kind` columns, add an email-invite
  creation path that stores a hashed one-time token, and wire an email provider
  behind `EMAIL_PROVIDER_CONFIGURED`. Re-enable the drawer's email tab.
- **Rate limiting:** add per-IP throttling on `POST /invites/:code/accept` if
  abuse appears.
- **Audit:** extend beyond `revokedAt` to a full invite-event log if needed.

## 10. PR scope

Single PR: schema + migration → shared schemas → server endpoints + tests →
client hooks + consumers + accept page. Coherent but sizeable; can split into a
server PR and a client PR if review prefers.
