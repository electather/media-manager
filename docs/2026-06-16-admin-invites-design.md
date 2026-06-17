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
wrapper (in-scope, §4.2). Code entropy (~90 bits, see §2) defends against *guessing* a
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
   expiry + max-uses + revoke. Trade-off: a database-level breach exposes every
   active invite code as an immediately-usable bearer credential. Acceptable given
   the closed-system threat model (self-hosted, small admin team), 90-bit entropy
   making offline brute-force infeasible, and the expiry + use-cap a creating admin
   sets bounding the blast radius of any single leaked code. Note these are
   admin-chosen knobs, not server-enforced ceilings: `expiresAt` has no maximum and
   `maxUses = 0` means unlimited, so an admin can mint a long-lived, uncapped link.
   The threat model relies on admins picking sane values; server-enforced upper
   bounds on TTL and uses are a possible future hardening (§9).
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
  code        text not null unique          -- bearer token + URL token (see §2 entropy note)
  roleId      text not null -> roles.id      -- role granted on accept
  invitedBy   text null     -> user.id ON DELETE SET NULL  -- admin who created it; null after admin deletion
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

**Code entropy:** the mock's `generateInviteCode` emits 18 hex chars (~72 bits).
The server generates the code from `crypto.getRandomValues` over an 18-char
Crockford base32 alphabet (`0-9A-HJKMNP-TV-Z`, 32 symbols) → ~90 bits, keeping the
familiar grouped (`XXXXXX-XXXXXX-XXXXXX`) shape while raising entropy and dropping
ambiguous characters. The `code` column is unique; on the astronomically unlikely
collision the insert retries up to 3 times before throwing a 500.

## 3. Shared schemas (`packages/shared/src/invites/`)

```
createInviteSchema = z.object({
  roleId:    z.string().min(1),
  expiresAt: z.number().int().positive(),   // ms timestamp; z.positive() rejects zero/negative but NOT past values
  maxUses:   z.number().int().min(0),       // 0 = unlimited; positive integer = use cap
})
```

`expiresAt > Date.now()` is enforced in the route handler (not in the schema) — a schema check would race and fail on slow networks. The handler rejects past timestamps with `400` before inserting the row.

`maxUses = 0` means unlimited. The atomic use-guard in `POST /invites/:code/accept` treats 0 as "no cap":

```sql
WHERE code = ?
  AND (maxUses = 0 OR uses < maxUses)
  AND expiresAt > now
  AND revokedAt IS NULL
```

The client drawer's existing unlimited option (`value="0"`) maps directly to `maxUses = 0`.

```
extendInviteSchema = z.object({
  expiresAt: z.number().int().positive(),   // same field as createInviteSchema; handler validates > Date.now()
})

acceptInviteSchema = z.object({
  name:     z.string().trim().min(1).max(NAME_MAX_LENGTH),
  email:    z.email(),
  password: passwordSchema,                  // reuse packages/shared/src/auth/password
})
```

DTOs:

- `AdminInviteDTO` — the server-side source of truth. Fields: `id`, `code`,
  `url` (absolute URL: `${APP_EXTERNAL_URL ?? origin}/auth/invite/<code>`,
  constructed server-side via the same pattern as `config.ts:14` — client copies
  it directly without prepending origin), `roleId`, `invitedBy: string | null` (null when
  the creating admin has been deleted), `createdAt`, `expiresAt`, `maxUses`,
  `uses`, `expired` (computed). `revokedAt` is **not** exposed (list excludes
  revoked rows). `lib/types.ts::AdminInvite` must be updated to match: make
  `code` required (link invites always have one), add `url: string`, and widen
  `invitedBy` to `string | null`.
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
    `requireAssignableRole` (and its helper `requireRole`) into
    `apps/server/src/api/procedures/assignable-role.ts` so both `users.ts` and
    `invites.ts` import one implementation. It lives under `api/procedures/` (not
    `auth/`): it imports `roleHasAdminTierPermission` from the auth barrel, and the
    barrel deliberately does not re-export `auth/internal/**`, so the guard stays
    on the API side of that boundary (see §8).
  - Generate an 18-char code, insert the row, return `AdminInviteDTO` with `url`.
- `GET /admin/invites`
  - List non-revoked invites, newest first, with computed `expired`/`uses`.
- `POST /admin/invites/:id/extend` (`zValidator("json", extendInviteSchema)`)
  - `extendInviteSchema = z.object({ expiresAt: z.number().int().positive() })` —
    same field as `createInviteSchema`; handler validates `expiresAt > Date.now()`.
    The API accepts any future absolute expiry. The v1 client UI sends a fixed
    `Date.now() + 7 days` from a single "extend" action (`invite-row.tsx`) rather
    than re-opening the expiry picker — extending is a one-click affordance on the
    list row, and 7 days is the common "give them another week" case. A
    custom-expiry picker on the row is a follow-up (the schema already supports it
    server-side). No `ttl` constant on the server — the value is chosen by the
    caller.
  - Set `expiresAt` to the supplied value; clear nothing else. (Named `extend`
    because nothing is sent or re-sent — the link already exists and the admin
    shares it manually. When the email-invite path lands, a separate `resend`
    endpoint handles re-delivery for `kind = 'email'` invites.)
  - **Exhausted guard:** if `uses >= maxUses` (and `maxUses != 0`) at the time of
    the call, the invite is fully consumed — extending the expiry alone would be
    useless. Reject with `409 Conflict` and body `{ code: "INVITE_EXHAUSTED" }`
    so the admin knows to create a new invite. (An exhausted invite with
    `maxUses = 0` is impossible by definition.)
- `DELETE /admin/invites/:id`
  - Set `revokedAt = now` (soft revoke). List excludes revoked rows.

### 4.2 Public subapp — `invitesApp` at `/invites`

No admin/session middleware — accepters are unauthenticated. Registered in `router.ts`.

Rate limits are applied **per-route**, not at the subapp level. The `/invites`
subapp does **not** receive the `publicIpRateLimit` outer wrapper:

- `GET /invites/:code` — `publicIpRateLimit` (capacity 60, refill 1/s). Cheap DB
  read; same budget class as `/public/*`. Separate bucket from the accept route,
  so a preview burst does not drain the accept budget.
- `POST /invites/:code/accept` — `acceptIpRateLimit` (capacity 5, refill 0.1/s),
  backed by `acceptIpLimiter: TokenBucketLimiter({ capacity: 5, refillPerSec: 0.1 })`.
  Each call triggers a scrypt hash; the lower cap bounds CPU exposure while still
  covering any legitimate single-IP use (an invitee submits once).

Both middlewares are defined in `api/rate-limit.ts` alongside `publicIpRateLimit`,
keyed by `clientIp`.

- `GET /invites/:code`
  - Look up by code. Return `InvitePreviewDTO` when active; `404` when missing;
    `410` when expired / exhausted / revoked.
- `POST /invites/:code/accept` (`zValidator("json", acceptInviteSchema)`)
  - Runs entirely inside **one `db.transaction`** so a later failure rolls back
    the use-count increment (no silently-burned use):
    1. **Atomic use guard** (single statement, race-safe under SQLite's
       serialized write model):
       ```
       UPDATE invites
          SET uses = uses + 1
        WHERE code = ?
          AND (maxUses = 0 OR uses < maxUses)
          AND expiresAt > ?        -- bind Date.now() ms; SQLite has no now() or CURRENT_TIMESTAMP in ms
          AND revokedAt IS NULL
       ```
       0 rows changed ⇒ throw → `410 Gone` (consumed/expired/revoked between
       preview and accept).
    2. **Unique-email check** within the txn — inline a `SELECT` on `user.email`
       using `tx` directly (do **not** call `requireUniqueEmail` from `users.ts`;
       that function calls `getDb()` internally and is not tx-aware). Duplicate ⇒
       throw → `409` with an "account exists — log in" body. (Checked before the
       insert so the failure is a clean 409, not a raw UNIQUE-constraint error; the
       txn rolls back the increment from step 1.)
    3. **Create the account** via `insertCredentialUserTx(tx, { email, password,`
       `name, roleId, emailVerified: true })` from
       `apps/server/src/auth/internal/create-user.ts`. This is the same primitive
       `claimBootstrap` uses inside its own transaction, so it composes with our
       `tx`. It writes the `user` + credential `account` rows directly (bypassing
       the disabled public sign-up endpoint) in the exact shape Better Auth's
       `sign-in/email` reads. `emailVerified: true` because holding a valid invite
       link is the proof of access (note: `createUserWithRole` is **not** used —
       it opens its own transaction and cannot set `emailVerified`).
  - Returns `{ ok: true }` — **no server-side session** (none of the
    existing creators, including `claimBootstrap`, mint one). The internal
    `userId` is intentionally omitted: this is a public unauthenticated
    endpoint, and the client does not need the ID (it signs in by email/password).
  - **Sign-in is client-side.** On a successful accept the client immediately
    calls Better Auth email sign-in with the just-submitted email + password
    (the credential `account` row was written precisely for `sign-in/email` to
    look up), then redirects to `/setup`. See §6.

## 5. Client — replace the mock

- `lib/query-keys.ts` — add `adminInvitesKeys` (`all` / `list`).
- `lib/fetchers.ts` — `fetchInvites`, `createInvite`, `extendInvite`,
  `revokeInvite` (admin, typed `hc`), plus `fetchInvitePreview` and `acceptInvite`
  for the accept page. **Coerce string → number:** the drawer keeps `maxUses` as
  `useState<string>`; `createInvite` must send `maxUses: Number(maxUses)` (not the
  raw string) so the `z.number()` schema accepts it.
- `hooks/` — `use-admin-invites.ts` (`useSuspenseQuery`), `use-create-invite.ts`,
  `use-extend-invite.ts`, `use-revoke-invite.ts` (mutations that invalidate
  `adminInvitesKeys` and the user-count query).
- Update consumers:
  - `components/invite-drawer.tsx` — call `useCreateInvite`; **hide the email
    tab**, keep the link tab (role + expiry + max-uses).
  - `components/invite-row.tsx` — extend/revoke via mutations; copy the
    server-returned `url`. The "resend" button label becomes "extend" — consistent
    with the backend endpoint name and avoids future confusion when email resend
    lands (§9). **Rename Paraglide message keys:** replace
    `m.admin_users_invite_resend()` (button) and `m.admin_users_invite_toast_resent()`
    (success toast) with new `admin_users_invite_extend` / `admin_users_invite_toast_extended`
    keys in `apps/client/messages/admin/en.json` and `fa.json`.
  - `components/users-list.tsx` — update the `isInviteActive(i, now)` call to
    `isInviteActive(i)` and remove the `const now = Date.now()` line (dead code
    after the callsite change).
  - `components/users-page.tsx` — `useInvitesMock` → `useAdminInvites`.
  - `lib/user-predicates.ts` — pending count derived from the real invite list.
    Update `isInviteActive` signature to `(invite: AdminInvite): boolean` returning
    `!invite.expired`. Update `deriveUserCounts` to call `isInviteActive(i)` (drop
    the `now` arg it currently passes). The server-computed `expired` flag encodes
    `expiresAt < now OR uses >= maxUses OR revokedAt != null` — no client-side
    recomputation needed.
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
- **Sign-in failure recovery:** account creation and sign-in are separate calls.
  If `acceptInvite` succeeds (2xx) but the subsequent `signIn.email` call fails
  (network error, transient Better Auth failure, etc.), the account already exists
  — the user should **not** retry the form, which would 409. Show an inline banner:
  "Your account was created. Sign-in failed — [go to login](/auth/login)." The
  login page handles the normal email + password flow and gets them in without
  re-registering.

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
- Sequential double-accept respects `maxUses` (atomic guard — second request
  returns 410 after first saturates the cap). In-memory SQLite is single-writer,
  so true concurrent writes are not testable here; the sequential form still
  exercises the atomic guard logic correctly.
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
EDIT packages/shared/package.json                        (add "./invites": "./src/invites/index.ts" to exports)
EDIT apps/server/src/api/procedures/users.ts             (import guard from new module below)
NEW  apps/server/src/api/procedures/assignable-role.ts   (shared role guard: requireRole + requireAssignableRole)
EDIT apps/server/src/api/router.ts                       (register both subapps)
EDIT apps/server/src/api/rate-limit.ts                   (add acceptIpLimiter + acceptIpRateLimit middleware)
NEW  apps/client/src/features/admin-users/hooks/use-admin-invites.ts
NEW  apps/client/src/features/admin-users/hooks/use-create-invite.ts
NEW  apps/client/src/features/admin-users/hooks/use-extend-invite.ts
NEW  apps/client/src/features/admin-users/hooks/use-revoke-invite.ts
EDIT apps/client/src/features/admin-users/lib/query-keys.ts
EDIT apps/client/src/features/admin-users/lib/fetchers.ts
EDIT apps/client/src/features/admin-users/lib/types.ts                  (AdminInvite: code required, add url, invitedBy nullable)
EDIT apps/client/src/features/admin-users/lib/user-predicates.ts
EDIT apps/client/src/features/admin-users/components/invite-drawer.tsx
EDIT apps/client/src/features/admin-users/components/invite-row.tsx
EDIT apps/client/src/features/admin-users/components/users-list.tsx        (isInviteActive call-site: drop now param)
EDIT apps/client/src/features/admin-users/components/users-page.tsx
EDIT apps/client/messages/admin/en.json                                    (rename resend→extend message keys)
EDIT apps/client/messages/admin/fa.json                                    (rename resend→extend message keys)
EDIT apps/client/src/routes/auth/invite.$token.tsx
DEL  apps/client/src/features/admin-users/lib/invites-mock.ts
```

## 9. Expansion path

- **Email invites:** activate the `email` + `kind` columns, add an email-invite
  creation path that stores a hashed one-time token, and wire an email provider
  behind `EMAIL_PROVIDER_CONFIGURED`. Re-enable the drawer's email tab.
- **Rate limiting:** `acceptIpLimiter` (capacity 5, refill 0.1/s) is in-scope for
  this PR (§4.2). Tighten further or add per-invite-code throttling if abuse evidence
  appears in practice.
- **Audit:** extend beyond `revokedAt` to a full invite-event log if needed.

## 10. PR scope

Single PR: schema + migration → shared schemas → server endpoints + tests →
client hooks + consumers + accept page. Coherent but sizeable; can split into a
server PR and a client PR if review prefers.
