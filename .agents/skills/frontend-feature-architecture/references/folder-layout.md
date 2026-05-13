# Folder layout

## Flat (1 surface)

Use when the feature has a single page, single widget, or one cohesive UI surface with no admin/user split.

Flat means **one surface**, not **all files at the feature root**. Keep the feature root small:
`index.ts` plus optional docs/fixtures only. Put page/UI files in `components/`, query/mutation hooks
in `hooks/`, and fetchers/query keys/types/helpers in `lib/`.

```
features/<name>/
├── index.ts                # barrel — exports cross-feature surfaces only
├── components/
│   ├── <name>-page.tsx
│   ├── <name>-skeleton.tsx
│   ├── <name>-empty.tsx
│   ├── <component>.tsx
│   └── <subcomponent>/     # decompose large components into sub-folders
├── hooks/
│   ├── use-<thing>.ts
│   └── use-<other>.ts
├── lib/
│   ├── fetchers.ts
│   ├── query-keys.ts
│   ├── types.ts            # DTOs, error class, label fns, META maps
│   ├── error-boundary.tsx
│   └── helpers.ts
└── __tests__/              # or co-located in components/, hooks/
```

Reference: [`apps/client/src/features/home/`](../../../../apps/client/src/features/home/) — a
single-surface flat feature with `components/`, `hooks/`, and `lib/`.

## Sibling Surface Features

Use this when the domain has many independent settings-like pages and the project wants to avoid
`features/<domain>/<surface>/` nesting. Name each page as its own top-level feature:

```
features/settings-security/
├── index.ts
├── components/
│   ├── settings-security-page.tsx
│   ├── sessions-card.tsx
│   └── password-change-card.tsx
├── hooks/
│   ├── use-sessions.ts
│   ├── use-revoke-session.ts
│   └── use-revoke-other-sessions.ts
├── lib/
│   ├── fetchers.ts
│   ├── query-keys.ts
│   └── types.ts
└── __tests__/
```

Route files still stay thin and import from the feature barrel. Do not put page components, hooks,
fetchers, query keys, or types directly at the feature root just because each surface is a separate
feature.

## Split (2+ surfaces)

Use when the feature has user-facing + admin-facing surfaces, or multiple distinct UI surfaces (page + popover widget + settings panel).

```
features/<name>/
├── index.ts
├── shared/                 # cross-surface plumbing
│   ├── fetchers.ts
│   ├── query-keys.ts
│   ├── types.ts
│   ├── error-boundary.tsx
│   └── <atom>.tsx          # cross-surface presentational atoms (chips, icons)
├── <surface-a>/
│   ├── <surface-a>-page.tsx
│   ├── use-<x>.ts
│   ├── <surface-a>-skeleton.tsx
│   ├── <surface-a>-empty.tsx
│   ├── <component>.tsx
│   ├── __tests__/
│   └── __fixtures__/
└── <surface-b>/
    └── ...
```

Reference: [`apps/client/src/features/notifications/`](../../../../apps/client/src/features/notifications/) — surfaces are `bell/`, `inbox/`, `settings/`, `admin/`.

## File naming

- Components: `kebab-case.tsx`. Default-export the matching `PascalCase` component name.
- Hooks: `use-<thing>.ts`. One hook per file.
- Pages: `<surface>-page.tsx` (split) or `<feature>-page.tsx` (flat).
- Skeletons: `<surface>-skeleton.tsx`.
- Empty states: `<surface>-empty.tsx`.
- Tests: `<file>.test.tsx` inside `__tests__/`.
- Fixtures: `__fixtures__/<topic>.ts`.

## What goes where

### Split layout — `shared/`

Lives here only if used by 2+ surfaces in this feature:

- `fetchers.ts` — all `api.*` calls
- `query-keys.ts` — the keys factory
- `types.ts` — DTOs, error class, label functions, META maps (icons/colors)
- `error-boundary.tsx` — feature ErrorBoundary that resets feature keys on retry
- Presentational atoms used by multiple surfaces (e.g. `category-chip.tsx`, `severity-icon.tsx`)

Single-surface helpers stay in the surface folder.

### Split layout — `<surface>/`

- `<surface>-page.tsx` — top-level shell, owns state, renders Suspense + ErrorBoundary
- `use-<x>.ts` — one hook per query/mutation; reads from `shared/`
- `<surface>-skeleton.tsx`, `<surface>-empty.tsx`
- Presentational components used only by this surface

### Flat layout — `lib/`

Same role as `shared/` but without the surface split. Contains `fetchers.ts`, `query-keys.ts`, `types.ts`, `error-boundary.tsx`, helpers.

### Flat layout — `components/`

Contains the page component and UI-only children. Large page files should be decomposed into
focused component files or one-level component subfolders, mirroring `features/home/components/card/`.

### Flat layout — `hooks/`

Contains query/mutation hooks only. Hooks read from `lib/` and export one hook per file. UI-only
component hooks can live beside the component that owns them.

## Promotion: flat → split

Promote when:

- A second surface lands (admin variant, or page + popover, or settings panel).
- Two or more components in `components/` need the same data layer plumbing AND have meaningfully different shells.

Mechanics:

1. Create `shared/` and move `lib/{fetchers,query-keys,types,error-boundary}.ts` into it.
2. Move `components/<x>/` files into `<surface>/` for each surface.
3. Move corresponding `hooks/use-<x>.ts` into the surface folder.
4. Update imports.
5. Update `index.ts` barrel — re-export only the cross-feature surfaces.

Don't demote split → flat. Cost outweighs benefit.

## Decomposing large components

A component file that grows large should split into a sub-component directory:

```
components/<component>/
├── index.tsx               # composes children
├── <component>-header.tsx
├── <component>-body.tsx
└── <component>-footer.tsx
```

Mirror the existing pattern in [`features/home/components/card/`](../../../../apps/client/src/features/home/components/card/).

**Cap depth at one sub-component level.** When the file you're decomposing already lives inside a `components/<x>/` sub-folder, add the splits as **siblings** in that same folder — do not create a nested `<x>/<thing>/` directory. Component-local UI hooks (rAF effects, observers) colocate as `use-<thing>.ts` siblings; only query/mutation hooks belong under feature-root `hooks/` (rule 7). See [`composition.md` § Don't double-nest](composition.md#dont-double-nest) for the visual guard.

## See also

- [`data-layer.md`](data-layer.md) for what lives in `fetchers.ts`/`query-keys.ts`/`types.ts`
- [`composition.md`](composition.md) for page → list → row layering
- Companion skills section in [`SKILL.md`](../SKILL.md)
