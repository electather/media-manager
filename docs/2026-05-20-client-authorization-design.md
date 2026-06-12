# Client-Side Authorization

## Goal

Global, expandable RBAC on client. Gate: routes, nav, arbitrary UI fragments.

## Constraints

- Server: Better Auth 1.6.x + custom RBAC (roles → rolePermissions → userRoles).
- Perms = flat `Permission[]` from `packages/shared/src/auth`.
- No extra fetch. No second cache. Piggyback on session.

---

## 1. Server — Augment Session

```
// auth/internal/config.ts — add customSession plugin
customSession(async ({ user, session }) => {
  perms = await authRepo.loadUserPermissions(user.id)
  return {
    session,                  // must spread base fields
    user,
    permissions: perms,       // Permission[] — top-level extra field
  }
})

// auth/repo.ts — new method (composes existing findUserRole)
loadUserPermissions(userId) →
  role = await findUserRole(userId)        // existing repo method
  IF !role → return []
  IF role.isSystemAdmin → return ALL_PERMISSIONS
  ELSE → return role.permissions[]         // already loaded by findUserRole join
```

Session shape after:
```
session.data = {
  user: { id, name, email, ... },
  session: { ... },
  permissions: ["ADMIN_USERS", "MEDIA_REQUEST", ...]
}
```

---

## 2. Client Auth Client — Add `customSessionClient`

`@nama/server` is already a devDependency of `apps/client`. Import `Auth` type only.

```
// apps/client/src/shared/lib/auth.ts
import type { Auth } from "@nama/server/auth"
import { customSessionClient } from "better-auth/client/plugins"

authClient = createAuthClient({
  plugins: [
    customSessionClient<Auth>(),   // types permissions onto session.data
    oauthProviderClient(),
  ]
})
```

`session.data.permissions` is now typed as `Permission[]` — no manual type maintenance.

---

## 3. Session Context — Pass to Child Routes

`_authenticated` `beforeLoad` currently returns nothing. Child routes re-fetch session independently → double network hit on every admin navigation. Fix: return session into context so admin guard reuses it.

```
// routes/_authenticated/route.tsx
beforeLoad: async ({ location }) →
  { data: session } = await authClient.getSession()
  if !session → throw redirect({ to: "/auth/login" })
  return { session }                    // available as Route.useRouteContext().session
```

```
// Extend RouterContext type
type RouterContext = {
  queryClient: QueryClient
  session: Session | null              // add this
}
```

---

## 4. Client Primitives

### 4a. `usePermission` hook

```
// apps/client/src/shared/hooks/use-permission.ts
usePermission(permission: Permission): boolean →
  session = authClient.useSession()
  return session.data?.permissions?.includes(permission) ?? false
```

Deny by default: `isPending` or `error` → returns `false`. No flash — `beforeLoad` awaits session before render.

### 4b. `useHasAnyPermission` hook

```
// apps/client/src/shared/hooks/use-has-any-permission.ts
useHasAnyPermission(permissions: Permission[]): boolean →
  session = authClient.useSession()
  granted = session.data?.permissions ?? []
  return permissions.some(p => granted.includes(p))
```

### 4c. `<Can>` component

```
// apps/client/src/shared/components/can.tsx
Can({ permission, fallback?, children }) →
  allowed = usePermission(permission)
  return allowed ? children : (fallback ?? null)
```

---

## 5. Route Guards

### Admin root route

Reuse session from context — no second `getSession` call.

```
// routes/_authenticated/_admin/route.tsx
beforeLoad({ context }) →
  permissions = context.session?.permissions ?? []
  hasAdmin = ADMIN_PERMISSIONS.some(p => permissions.includes(p))
  if !hasAdmin → throw redirect({ to: "/" })
```

`ADMIN_PERMISSIONS` — new `as const` tuple added to `packages/shared/src/auth/index.ts`:
```
export const ADMIN_PERMISSIONS = [
  PERMISSIONS.ADMIN_USERS,
  PERMISSIONS.ADMIN_ROLES,
  PERMISSIONS.ADMIN_SERVER,
  PERMISSIONS.ADMIN_REQUESTS,
  PERMISSIONS.ADMIN_PLUGINS,
  PERMISSIONS.ADMIN_JOBS,
] as const satisfies Permission[]
```

### Per-route guard (opt-in)

```
// e.g. routes/_authenticated/_admin/users/route.tsx
beforeLoad({ context }) →
  if !context.session?.permissions?.includes("ADMIN_USERS") →
    throw redirect({ to: "/admin" })
```

Applied only where a user could have partial admin access (e.g. ADMIN_PLUGINS but not ADMIN_USERS). Most admin routes covered by root guard alone.

---

## 6. Admin Nav Visibility

```
// _admin layout component
<Can permission="ADMIN_USERS">    <NavItem to="/admin/users" /></Can>
<Can permission="ADMIN_ROLES">    <NavItem to="/admin/roles" /></Can>
<Can permission="ADMIN_REQUESTS"> <NavItem to="/admin/requests" /></Can>
<Can permission="ADMIN_PLUGINS">  <NavItem to="/admin/plugins" /></Can>
<Can permission="ADMIN_JOBS">     <NavItem to="/admin/jobs" /></Can>
<Can permission="ADMIN_SERVER">   <NavItem to="/admin/server" /></Can>
```

No flash: `useSession()` is synchronously hydrated from the same cache populated by `getSession()` in `beforeLoad`. Session already resolved before layout renders.

---

## 7. File Map

```
packages/shared/src/auth/index.ts
  + ADMIN_PERMISSIONS tuple

apps/server/src/auth/internal/config.ts
  + customSession plugin

apps/server/src/auth/repo.ts
  + loadUserPermissions() — composes loadUserRole()

apps/client/src/shared/lib/auth.ts
  + customSessionClient<Auth>() plugin

apps/client/src/routes/_authenticated/route.tsx
  + return { session } from beforeLoad
  + extend RouterContext type

apps/client/src/routes/_authenticated/_admin/route.tsx
  + beforeLoad admin guard (uses context.session)

apps/client/src/shared/hooks/use-permission.ts          new
apps/client/src/shared/hooks/use-has-any-permission.ts  new
apps/client/src/shared/components/can.tsx               new
```

---

## 8. Expansion Path

Add perm → add to `PERMISSIONS` in shared → server grants via `rolePermissions` row → session carries it automatically. Zero client-side mapping changes.

New gate type (e.g. feature flags) → new hook alongside `usePermission`, same session source. `<Can>` stays permission-only; `<Feature flag="...">` added separately if needed.

---

## Non-Goals

- Optimistic permission caching beyond session TTL (5-min cookie cache sufficient).
- Per-component loading skeletons gated by permissions.
- Role name/metadata exposure on client (permissions only).
