---
goal: Add global, expandable client-side authorization (route guards, nav visibility, component-level rendering)
version: 1.0
date_created: 2026-05-20
last_updated: 2026-05-20
owner: Omid Astaraki
status: 'Planned'
tags: [feature, auth, rbac, client]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

Adds client-side RBAC by piggybacking permissions onto the existing Better Auth session via `customSession`. Implements three gates: route-level redirects, nav visibility, and arbitrary UI fragment control via a `<Can>` component. No extra network round-trip — permissions ride the session cache.

Spec: `docs/2026-05-20-client-authorization-design.md`

---

## 1. Requirements & Constraints

- **REQ-001**: Permissions must be a flat `Permission[]` on `session.data` — no grouped structure, no boolean map.
- **REQ-002**: `usePermission` and `<Can>` must deny (return `false` / render `null`) when session is loading or in error state.
- **REQ-003**: Admin route guard must use `context.session` from parent `beforeLoad` — no second `getSession` call.
- **REQ-004**: `<Can>` accepts an optional `fallback` prop rendered when permission is denied.
- **REQ-005**: `ADMIN_PERMISSIONS` must be exported from `packages/shared/src/auth/index.ts` as `as const satisfies Permission[]`.
- **SEC-001**: System admin role bypass: `loadUserPermissions` must return `ALL_PERMISSIONS` when `role.isSystemAdmin` is true.
- **SEC-002**: Default deny — any missing or falsy permission check returns `false`, never `true`.
- **CON-001**: `packages/shared` has no runtime deps besides `zod` — no drizzle, no server imports.
- **CON-002**: `@ent-mcp/server` is a devDependency of `apps/client` — use `import type` only.
- **CON-003**: `customSession` return must include `session` and `user` fields alongside `permissions` — omitting base fields breaks auth.
- **CON-004**: `loadUserPermissions` lives in `apps/server/src/auth/repo.ts` and composes existing `findUserRole` (not `loadUserRole` from service layer).
- **GUD-001**: Follow `frontend-feature-architecture` skill for new client files under `apps/client/src/shared/`.
- **GUD-002**: No barrel `index.ts` added to `apps/client/src/shared/` — consumers use deep import paths.
- **PAT-001**: Route guards read `context.session` injected by `_authenticated` `beforeLoad`, not a fresh `getSession` call.

---

## 2. Implementation Steps

### Implementation Phase 1 — Shared: `ADMIN_PERMISSIONS` constant

- GOAL-001: Export `ADMIN_PERMISSIONS` tuple from shared auth package so both client and server can import it without duplicating the list.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | In `packages/shared/src/auth/index.ts`, after line 22 (after `ALL_PERMISSIONS`), add: `export const ADMIN_PERMISSIONS = [ PERMISSIONS.ADMIN_USERS, PERMISSIONS.ADMIN_ROLES, PERMISSIONS.ADMIN_SERVER, PERMISSIONS.ADMIN_REQUESTS, PERMISSIONS.ADMIN_PLUGINS, PERMISSIONS.ADMIN_JOBS, ] as const satisfies Permission[];` | | |

---

### Implementation Phase 2 — Server: `loadUserPermissions` + `customSession`

- GOAL-002: Augment the Better Auth session response with a `permissions: Permission[]` field loaded from the DB on session resolution.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-002 | In `apps/server/src/auth/repo.ts`, add new exported async function `loadUserPermissions(userId: string): Promise<Permission[]>`. Implementation: call `findUserRole(userId)` (already exported on line 13). If result is null return `[]`. If `result.role.isSystemAdmin` is true return `ALL_PERMISSIONS` (imported from `@ent-mcp/shared/auth`). Otherwise return the permissions array already present on the `findUserRole` result. | | |
| TASK-003 | In `apps/server/src/auth/internal/config.ts`, import `customSession` from `better-auth/plugins` and `loadUserPermissions` from `../repo`. After the closing `}` of the `session` block (line 49), add the `customSession` plugin call: `customSession(async ({ user, session }) => { const permissions = await loadUserPermissions(user.id); return { session, user, permissions }; })`. Register it in the `plugins` array of the `betterAuth` call. | | |

---

### Implementation Phase 3 — Client: Auth Client + Router Context

- GOAL-003: Wire `customSessionClient<Auth>()` onto the auth client so `session.data.permissions` is typed, and thread session into TanStack Router context so child routes avoid re-fetching.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-004 | In `apps/client/src/shared/lib/auth.ts`: add `import type { Auth } from "@ent-mcp/server/auth";` and `import { customSessionClient } from "better-auth/client/plugins";`. Add `customSessionClient<Auth>()` as the first entry in the `plugins` array (before `oauthProviderClient()`). | | |
| TASK-005 | In `apps/client/src/routes/__root.tsx`, extend `RouterContext` interface (lines 6–8) to add `session: Awaited<ReturnType<typeof authClient.getSession>>["data"]` — import `authClient` from `@/shared/lib/auth`. This makes `context.session` available in all child `beforeLoad` hooks. | | |
| TASK-006 | In `apps/client/src/routes/_authenticated/route.tsx`, update the `beforeLoad` function: after successfully resolving `session` (line 9), add `return { session };` inside the `try` block before the catch. This threads the resolved session into router context without a second network call. | | |

---

### Implementation Phase 4 — Client: Permission Primitives

- GOAL-004: Create `usePermission`, `useHasAnyPermission`, and `<Can>` as the three reusable authorization primitives consumed throughout the app.

Tasks in this phase are independent and can be executed in parallel.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-007 | Create `apps/client/src/shared/hooks/use-permission.ts`. Export `usePermission(permission: Permission): boolean`. Body: `const session = authClient.useSession(); return session.data?.permissions?.includes(permission) ?? false;`. Import `Permission` from `@ent-mcp/shared/auth` and `authClient` from `@/shared/lib/auth`. | | |
| TASK-008 | Create `apps/client/src/shared/hooks/use-has-any-permission.ts`. Export `useHasAnyPermission(permissions: Permission[]): boolean`. Body: `const session = authClient.useSession(); const granted = session.data?.permissions ?? []; return permissions.some((p) => granted.includes(p));`. Same imports as TASK-007. | | |
| TASK-009 | Create `apps/client/src/shared/components/can.tsx`. Export `Can` component with props `{ permission: Permission; fallback?: React.ReactNode; children: React.ReactNode }`. Body: `const allowed = usePermission(permission); return allowed ? <>{children}</> : <>{fallback ?? null}</>;`. Import `usePermission` from `@/shared/hooks/use-permission`. | | |

---

### Implementation Phase 5 — Client: Route Guards + Admin Nav

- GOAL-005: Enforce admin access at route level and hide nav items the user lacks permission for.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-010 | In `apps/client/src/routes/_authenticated/_admin/route.tsx`, add `beforeLoad({ context }: { context: RouterContext })` to the `createFileRoute` config object. Body: `const permissions = context.session?.permissions ?? []; const hasAdmin = ADMIN_PERMISSIONS.some((p) => permissions.includes(p)); if (!hasAdmin) throw redirect({ to: "/" });`. Import `ADMIN_PERMISSIONS` from `@ent-mcp/shared/auth`, `redirect` from `@tanstack/react-router`, and `RouterContext` from `@/routes/__root`. | | |
| TASK-011 | Locate the admin nav component (rendered by `AdminLayout` in `apps/client/src/app/admin-layout.tsx` or equivalent). Wrap each nav item in `<Can>` with its corresponding permission: `ADMIN_USERS` → users link, `ADMIN_ROLES` → roles link, `ADMIN_REQUESTS` → requests link, `ADMIN_PLUGINS` → plugins link, `ADMIN_JOBS` → jobs link, `ADMIN_SERVER` → server/diagnostics link. Import `Can` from `@/shared/components/can`. | | |

---

### Implementation Phase 6 — Changeset + Tests

- GOAL-006: Ship changeset entry and verify correctness with targeted unit tests.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-012 | Create `.changeset/<slug>.md` with frontmatter `"@ent-mcp/client": minor` and body: `"Added global client-side authorization with route guards, nav visibility control, and a Can component."` | | |
| TASK-013 | Write unit tests for `usePermission`: (a) returns `true` when permission present in session, (b) returns `false` when permission absent, (c) returns `false` when `session.data` is null (unauthenticated), (d) returns `false` when `session.isPending` is true. Mock `authClient.useSession` to control session shape. | | |
| TASK-014 | Write unit tests for `useHasAnyPermission`: (a) returns `true` when at least one permission matches, (b) returns `false` when no permissions match, (c) returns `false` on empty session. | | |
| TASK-015 | Write unit tests for `<Can>`: (a) renders `children` when `usePermission` returns `true`, (b) renders `null` when `usePermission` returns `false` and no `fallback`, (c) renders `fallback` when `usePermission` returns `false` and `fallback` provided. | | |
| TASK-016 | Run `vp check` and `vp test` — both must pass with zero errors before marking phase complete. | | |

---

## 3. Alternatives

- **ALT-001**: Separate `/api/me/permissions` endpoint — rejected because it adds a second round-trip and requires manual cache invalidation on role change. Piggybacking on session is simpler and always in sync.
- **ALT-002**: Store role name in session and map to permissions client-side — rejected because it duplicates server-side permission logic on the client and breaks when role permissions change without a re-login.
- **ALT-003**: Hook-only API (no `<Can>` component) — rejected because declarative `<Can>` is cleaner for nav visibility and component-level gating than ternary expressions scattered across JSX.

---

## 4. Dependencies

- **DEP-001**: `better-auth` ≥ 1.6.x — `customSession` plugin and `customSessionClient` must be available. Confirmed present.
- **DEP-002**: `@ent-mcp/server` listed as devDependency in `apps/client/package.json` — required for `import type { Auth }` in TASK-004. Already present.
- **DEP-003**: `ADMIN_PERMISSIONS` constant (TASK-001) must be complete before TASK-010 (admin route guard) can reference it.
- **DEP-004**: `customSessionClient<Auth>()` (TASK-004) must be wired before any hook or component that reads `session.data.permissions` is tested against a real session.

---

## 5. Files

- **FILE-001**: `packages/shared/src/auth/index.ts` — add `ADMIN_PERMISSIONS` tuple (modified)
- **FILE-002**: `apps/server/src/auth/repo.ts` — add `loadUserPermissions()` (modified)
- **FILE-003**: `apps/server/src/auth/internal/config.ts` — add `customSession` plugin (modified)
- **FILE-004**: `apps/client/src/shared/lib/auth.ts` — add `customSessionClient<Auth>()` (modified)
- **FILE-005**: `apps/client/src/routes/__root.tsx` — extend `RouterContext` with `session` field (modified)
- **FILE-006**: `apps/client/src/routes/_authenticated/route.tsx` — return `{ session }` from `beforeLoad` (modified)
- **FILE-007**: `apps/client/src/routes/_authenticated/_admin/route.tsx` — add `beforeLoad` admin guard (modified)
- **FILE-008**: `apps/client/src/app/admin-layout.tsx` (or equivalent nav file) — wrap nav items in `<Can>` (modified)
- **FILE-009**: `apps/client/src/shared/hooks/use-permission.ts` — new
- **FILE-010**: `apps/client/src/shared/hooks/use-has-any-permission.ts` — new
- **FILE-011**: `apps/client/src/shared/components/can.tsx` — new
- **FILE-012**: `.changeset/<slug>.md` — new

---

## 6. Testing

- **TEST-001**: `usePermission` — returns `true` when named permission is in `session.data.permissions`.
- **TEST-002**: `usePermission` — returns `false` when named permission is absent.
- **TEST-003**: `usePermission` — returns `false` when `session.data` is `null`.
- **TEST-004**: `usePermission` — returns `false` when `session.isPending` is `true`.
- **TEST-005**: `useHasAnyPermission` — returns `true` when at least one of the supplied permissions is granted.
- **TEST-006**: `useHasAnyPermission` — returns `false` when none of the supplied permissions are granted.
- **TEST-007**: `useHasAnyPermission` — returns `false` on null session.
- **TEST-008**: `<Can>` — renders `children` when underlying `usePermission` is `true`.
- **TEST-009**: `<Can>` — renders `null` when `usePermission` is `false` and no `fallback` supplied.
- **TEST-010**: `<Can>` — renders `fallback` when `usePermission` is `false` and `fallback` prop supplied.

---

## 7. Risks & Assumptions

- **RISK-001**: `customSession` callback runs on every session resolution — if `loadUserPermissions` is slow (cold DB query) it adds latency to every authenticated request. Mitigation: the existing 5-minute cookie cache on the session means this fires at most once per 5 minutes per client, not per request.
- **RISK-002**: `findUserRole` join already loads `rolePermissions` rows — if that join changes shape, `loadUserPermissions` breaks silently. Mitigation: tests in TASK-013 will catch this via integration.
- **RISK-003**: `import type { Auth }` from `@ent-mcp/server/auth` in `apps/client` relies on the server package exporting `Auth` type from its `auth` subpath. Confirmed: `apps/server/src/auth/internal/config.ts` line 130 exports `export type Auth = typeof auth` and `apps/server/src/auth/index.ts` re-exports it.
- **ASSUMPTION-001**: `authClient.useSession()` is synchronously hydrated from the same cache as `authClient.getSession()` called in `beforeLoad`. This means `<Can>` renders with the correct permissions on first paint without a loading flicker.
- **ASSUMPTION-002**: Each user has at most one role (enforced by unique constraint on `userRoles.userId`). `loadUserPermissions` can assume a single role result.

---

## 8. Related Specifications / Further Reading

- [Client Authorization Design](../docs/2026-05-20-client-authorization-design.md)
- [Better Auth `customSession` plugin docs](https://www.better-auth.com/docs/plugins/custom-session)
- [TanStack Router `beforeLoad` context docs](https://tanstack.com/router/latest/docs/framework/react/guide/route-context)
