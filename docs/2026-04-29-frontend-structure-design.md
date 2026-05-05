# Frontend Structure — Client App

**Status:** Draft
**Date:** 2026-04-29
**Author:** Omid Astaraki
**Scope:** `apps/client/`
**Related:** `2026-04-23-home-feed-frontend-design.md`, `.fallowrc.json`

## Summary

Feature-first src layout. Three top-level domains under `apps/client/src/`:

- `app/` = shell + root chrome. ⊥ depend on features.
- `features/<x>/` = self-contained domain modules. Public surface = `index.ts`. Internals invisible to siblings.
- `shared/` = primitives + cross-cutting utils.

Fallow zones replace flat `client-components/hooks/lib`. Sibling-feature import = boundary violation.

## Goals

- Feature isolation. Delete folder = delete feature.
- Hard line: shared vs feature. `shared/` ⊥ holds feature logic.
- Predictable placement. New code → answer "feature or shared?" picks dir.
- Boundary enforcement via fallow, ⊥ convention.
- Low ceremony. One barrel per feature, none nested.

## Non-goals

- Restructuring server. `apps/server/` zones unchanged.
- Touching `packages/*` (plugin-sdk, shared, plugins).
- Migrating routes off file-based. TanStack Router constraint.
- Forced barrel exports inside features.
- Per-feature `package.json` / bundler split.

## Layout

```
apps/client/src/
├── main.tsx
├── globals.css
├── routeTree.gen.ts
├── vite-env.d.ts
│
├── app/                              # shell, root chrome
│   ├── app-shell.tsx
│   ├── auth-layout.tsx
│   ├── bottom-nav.tsx
│   ├── command-menu/                 # ⌘K palette wired to `client-shared-components` provider
│   ├── nav-items.ts
│   ├── profile-dropdown.tsx
│   └── settings-layout.tsx
│
├── features/
│   ├── connections/{components,hooks,lib,__tests__}/ + index.ts
│   ├── settings/{components,__tests__}/ + index.ts
│   ├── admin/components/ + index.ts
│   ├── jobs/components/ + index.ts
│   └── home/                                                # NEW
│       ├── components/
│       ├── hooks/
│       ├── lib/
│       │   ├── collections/   # media-collection, row-entries-collection, progress-collection
│       │   └── mutations.ts
│       ├── __tests__/
│       └── index.ts
│
├── shared/
│   ├── ui/                  # shadcn primitives only
│   ├── components/          # cross-feature visuals
│   ├── hooks/               # cross-cutting hooks
│   └── lib/                 # api, auth, themes, errors, utils
│
└── routes/                  # thin, file-based, imports features only
```

`features/auth/` lazy-create on first extraction. Empty stub ⊥ added.

## File map

| Current                                                                               | Target                                                                      |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `components/app-shell/*`                                                              | `app/*`                                                                     |
| `components/settings/settings-layout.tsx`                                             | `app/settings-layout.tsx`                                                   |
| `components/ui/*`                                                                     | `shared/ui/*`                                                               |
| `components/error-boundary.tsx`                                                       | `shared/components/error-boundary.tsx`                                      |
| `components/logo.tsx`                                                                 | `shared/components/logo.tsx`                                                |
| `components/not-found.tsx`                                                            | `shared/components/not-found.tsx`                                           |
| `components/user-avatar.tsx`                                                          | `shared/components/user-avatar.tsx`                                         |
| `components/log-viewer.tsx`                                                           | `shared/components/log-viewer.tsx`                                          |
| `components/json-viewer.tsx`                                                          | `shared/components/json-viewer.tsx`                                         |
| `components/pickers.tsx`                                                              | `shared/components/pickers.tsx`                                             |
| `components/cron-schedule.tsx`                                                        | `shared/components/cron-schedule.tsx`                                       |
| `components/connections/*`                                                            | `features/connections/components/*`                                         |
| `components/settings/{authorized-app-row,session-row}.tsx`                            | `features/settings/components/*`                                            |
| `components/admin/*`                                                                  | `features/admin/components/*`                                               |
| `components/jobs/*`                                                                   | `features/jobs/components/*`                                                |
| `components/auth-shell/`                                                              | **delete** (empty, unused)                                                  |
| `__tests__/settings/*`                                                                | `features/settings/__tests__/*`                                             |
| `hooks/use-now.ts`                                                                    | `shared/hooks/use-now.ts`                                                   |
| `lib/{api,auth,themes,utils,capabilities,relative-time,anchor-download,user-agent}.*` | `shared/lib/*`                                                              |
| `lib/errors/`                                                                         | `shared/lib/errors/`                                                        |
| `lib/__tests__/*`                                                                     | `shared/lib/__tests__/*`                                                    |
| `lib/home-display.ts`                                                                 | `features/home/lib/home-display.ts` (transient — home-feed design kills it) |

## Fallow zones

Replace existing `client-*` zones in `.fallowrc.json`. Per-feature zone materialized for each `features/<x>/`.

```jsonc
{
  "boundaries": {
    "zones": [
      { "name": "client-routes", "patterns": ["apps/client/src/routes/**"] },
      { "name": "client-app", "patterns": ["apps/client/src/app/**"] },

      { "name": "client-feat-home", "patterns": ["apps/client/src/features/home/**"] },
      {
        "name": "client-feat-connections",
        "patterns": ["apps/client/src/features/connections/**"],
      },
      { "name": "client-feat-settings", "patterns": ["apps/client/src/features/settings/**"] },
      { "name": "client-feat-admin", "patterns": ["apps/client/src/features/admin/**"] },
      { "name": "client-feat-jobs", "patterns": ["apps/client/src/features/jobs/**"] },

      { "name": "client-shared-ui", "patterns": ["apps/client/src/shared/ui/**"] },
      { "name": "client-shared-components", "patterns": ["apps/client/src/shared/components/**"] },
      { "name": "client-shared-hooks", "patterns": ["apps/client/src/shared/hooks/**"] },
      { "name": "client-shared-lib", "patterns": ["apps/client/src/shared/lib/**"] },

      { "name": "client-root", "patterns": ["apps/client/src/*.*"] },
    ],
  },
}
```

### Allow rules

| From                       | Allow                                                                           |
| -------------------------- | ------------------------------------------------------------------------------- |
| `client-root`              | `client-routes`, `client-app`, `client-feat-*`, `client-shared-*`, `shared-pkg` |
| `client-routes`            | `client-app`, `client-feat-*`, `client-shared-*`, `shared-pkg`                  |
| `client-app`               | `client-shared-*`, `shared-pkg`                                                 |
| `client-feat-<x>`          | `client-shared-*`, `shared-pkg`                                                 |
| `client-shared-components` | `client-shared-{ui,hooks,lib}`, `shared-pkg`                                    |
| `client-shared-hooks`      | `client-shared-lib`, `shared-pkg`                                               |
| `client-shared-ui`         | `client-shared-lib`, `shared-pkg`                                               |
| `client-shared-lib`        | `shared-pkg`, `server-api`, `server-root`                                       |

Critical invariants:

- `client-feat-<x>` ⊥ allow `client-feat-<y>`. Sibling-feature reach = violation.
- `features/home/lib/mutations.ts` imports RPC client via `@/shared/lib/api`, ⊥ direct `server-api` import. RPC client = sole bridge.
- `client-app` ⊥ allow `client-feat-*`. Shell stays feature-agnostic; if shell needed feature data, that feature's bundle = always-eager.
- `client-shared-*` ⊥ allow `client-feat-*`. Shared = primitives only.

## Public API rules

- Each `features/<x>/` has `index.ts`. Exports = public surface.
- Outside-feature import path = `@/features/<x>` (resolves to `index.ts`). Never `@/features/<x>/components/foo`.
- Inside-feature imports = relative paths. ⊥ barrels in subdirs (`components/index.ts` etc).
- Drilling through subdir barrels breaks tree-shake + invites circular imports.

### Naming

- Components: `kebab-case.tsx`, default export = component.
- Hooks: `use-foo.ts`, named export `useFoo`.
- Lib: `kebab-case.ts`, named exports.
- Tests: colocated `__tests__/`, `<name>.test.{ts,tsx}`.

### Path alias

Add to `tsconfig.json` + `vite.config.ts` resolve:

```jsonc
{
  "compilerOptions": {
    "paths": {
      "@/app/*": ["apps/client/src/app/*"],
      "@/features/*": ["apps/client/src/features/*"],
      "@/shared/*": ["apps/client/src/shared/*"],
      "@/routes/*": ["apps/client/src/routes/*"],
    },
  },
}
```

Vitest inherits Vite resolve. ⊥ duplicate config.

## Migration plan

Order minimizes broken state. Each step = one PR, own changeset.

1. **Path aliases.** Add `@/app`, `@/features`, `@/shared` to ts + vite + vitest. ⊥ move files yet. Lands resolver groundwork.
2. **Move shared.** `components/{ui,error-boundary,logo,not-found,user-avatar,log-viewer,json-viewer,pickers,cron-schedule}` → `shared/`. `hooks/use-now.ts` → `shared/hooks/`. `lib/*` (except `home-display.ts`) → `shared/lib/`. Update fallow: add `client-shared-*` zones, drop old `client-{components,hooks,lib}` zones.
3. **Carve `app/`.** `components/app-shell/*` + `components/settings/settings-layout.tsx` → `app/`. Add `client-app` zone w/ updated patterns. Delete empty `components/auth-shell/`.
4. **Lift cross-feature offenders to `shared/components/`.** Required pre-step before per-feature zones land. Today `components/admin/shared-credentials/dialog.tsx` imports `components/connections/schema-form` — direct sibling-feature reach. Move `schema-form.tsx` → `shared/components/schema-form.tsx`. Generic JSON-schema renderer ≠ feature-specific. Re-grep ∀ remaining cross-feature imports before step 5.
5. **Move features sequentially.** Order: `connections` → `settings` → `admin` → `jobs`. Each PR: move files, add `client-feat-<x>` zone, write `index.ts` barrel, update consumers, move tests, regen `routeTree.gen.ts`. ⊥ batch — one feature per PR keeps diff reviewable.
6. **`features/home/`.** Built fresh per home-feed design. Net-new under new structure. `lib/home-display.ts` → `features/home/lib/home-display.ts`.
7. **Drop transient `home-display.ts`.** Separate PR after home-feed Card lands per `2026-04-23-home-feed-frontend-design.md`. Blocked on home-feed shipping.
8. **Verify.** `vp check` + `vp test` + `vp dlx fallow` after each step. Fallow run = boundary gate; ⊥ skip.

Each PR ships own changeset. Internal-only refactor = empty frontmatter:

```md
---
---
```

## Conventions

- New feature = new dir under `features/`. Spawn `index.ts` immediately.
- Component grows feature-specific deps = leaves `shared/`.
- Two features need same util = belongs in `shared/lib/`.
- Two features need same component = first move lifts to `shared/components/`. ⊥ inline duplicate.
- Routes ≤30 lines. Logic in features.
- Tests colocate. ⊥ orphan in `apps/client/src/__tests__/`.

## Decided (was open)

- Path alias prefix = `@/` (shadcn default, React convention).
- `shared/ui/` keeps `ui/` name (matches shadcn `components.json`).
- `shared/lib/api.ts` retains `server-api` + `server-root` allowance — generated RPC types live server-side.
- `features/auth/` lazy-create on first extraction.
- `lib/__tests__/` flattens to `shared/lib/__tests__/` per current pattern. Per-subject colocation rule applies to features, ⊥ shared lib.

## Open questions

- **Storybook / component sandbox.** ⊥ in scope.
- **Per-feature lazy bundle splitting.** Future. TanStack Router code-splits routes; barrels ⊥ block lazy.

## Implementation review notes

PRs MUST address:

- **Barrel completeness.** `features/<x>/index.ts` re-exports ∀ public symbols. Missing export → consumer reaches into internals → boundary violation.
- **Test colocation.** Tests move w/ subject. ⊥ orphan in root `__tests__/`.
- **Path alias resolution.** TS + Vite + Vitest configs all updated. ⊥ "works in IDE, fails in build".
- **`vp check` zero-warning baseline.** After each migration PR, fallow + oxlint clean.
- **`routeTree.gen.ts`.** Generated. ⊥ hand-edit. Regenerate after route imports change.
- **Changeset per PR.** Internal-only refactor = empty frontmatter.
- **`home-display.ts` lifecycle.** Lives in `features/home/lib/` until home-feed Card kills it. Removal = separate PR.
- **`shadcn` `components.json` paths.** Update `aliases` keys (`components`, `ui`, `lib`, `hooks`, `utils`) to match new tree, else `vp dlx shadcn add` writes to wrong dirs.
- **Fallow zone test.** After zones change, run `vp dlx fallow` (or local equivalent) to verify ⊥ regressions in existing zone violations.
- **Sibling-feature import audit.** Pre-migration grep: any current cross-feature import? If yes, lift to `shared/` before move. Common candidates: `components/connections/schema-form` used by settings? Check before step 4.
