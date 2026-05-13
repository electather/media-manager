---
name: frontend-feature-architecture
description: Standard architecture for apps/client/src/features/* modules. Use when creating a new feature, retrofitting an existing feature, or reviewing feature-folder PRs. Covers folder layout (flat vs surfaces+shared), data layer (Hono api.* client, query-keys factory, typed error class), React Query rules (Suspense reads, optimistic mutations, polling), and composition (page → list → row, Suspense + ErrorBoundary placement). Notifications is the canonical example.
metadata:
  version: "1.0.0"
---

# Frontend Feature Architecture

Standard architecture for `apps/client/src/features/*` modules. Defines **where code lives**. Companion skills (vercel-react-best-practices, vercel-composition-patterns, paraglide-js, shadcn, web-design-guidelines, es-toolkit, vercel-react-view-transitions) define **how code reads** — invoke them in addition to this skill.

Skip this skill for `apps/server`, `packages/shared`, `packages/plugin-sdk`, `packages/plugins/*`.

## Canonical example

Live reference: [`apps/client/src/features/notifications/`](../../../apps/client/src/features/notifications/). When in doubt, mirror its shape.

## Decision tree

```
new feature?
├─ 1 surface (single page or single widget)
│   └─ flat layout — see references/folder-layout.md
│       features/<name>/{index.ts, components/, hooks/, lib/, __tests__/}
│
└─ 2+ surfaces (e.g. user page + admin page, or page + popover widget)
    └─ split layout — see references/folder-layout.md
        features/<name>/
        ├── index.ts
        ├── shared/                  # MUST exist if 2+ surfaces
        │   ├── fetchers.ts
        │   ├── query-keys.ts
        │   ├── types.ts
        │   ├── error-boundary.tsx
        │   └── <atom>.tsx
        └── <surface>/               # one folder per surface
            ├── <surface>-page.tsx
            ├── use-<x>.ts
            ├── <surface>-skeleton.tsx
            ├── <surface>-empty.tsx
            ├── <component>.tsx
            └── __tests__/, __fixtures__/
```

Promote flat → split when a second surface lands. Don't demote; cost outweighs benefit.

Flat layout means **single-surface**, not **root-flat**. Keep implementation files under
`components/`, query/mutation hooks under `hooks/`, and data/helpers under `lib/`. The feature
root should normally contain only `index.ts` and optional docs/fixtures.

If the project or user asks for sibling surface features instead of nested surfaces, use
`features/<domain>-<surface>/` for each surface, but still keep the flat subfolders inside each
feature. Example: `features/settings-security/{index.ts, components/, hooks/, lib/}`.

## Hard rules

Cite by number in PR descriptions and reviews.

1. **Hono client only.** Fetchers MUST go through `api.*` from `@/shared/lib/api`. No raw `fetch()` in `features/**`. Exception: streaming/SSE/uploads — comment with the constraint inline.
2. **Centralized fetchers.** All API calls live in `<feature>/shared/fetchers.ts` (split) or `<feature>/lib/fetchers.ts` (flat). Each is a thin wrapper; on `!res.ok` call shared `throwOnError` that builds typed error. No fetch logic in hooks/components.
3. **Typed error class.** One `<Feature>ApiError extends Error` per feature in `types.ts`, carrying `status`, `body`, `code`. ErrorBoundary fallback reads typed fields.
4. **Query-keys factory.** Hierarchical const object: `<feature>Keys.all`, `.x()`, `.x(filters)`, nested groups (`.admin.x()`). Filters are part of the key. Ad-hoc `["foo", "bar"]` arrays at call sites are forbidden.
5. **Suspense reads.** `useSuspenseQuery` / `useSuspenseInfiniteQuery` for primary fetches; page wraps consumer in `<Suspense fallback={<Skeleton/>}>` plus feature `ErrorBoundary`. `useQuery` only for polling/optional/non-blocking data.
6. **Optimistic mutations** for user-perceived state. Pattern: cancel queries → snapshot → `setQueriesData` patch → return ctx → `onError` restore → `onSettled` invalidate. Heuristic: if user clicks the thing and waits more than ~100ms before UI updates, mutation MUST be optimistic. Invalidate-only OK for low-stakes background ops.
7. **One hook per query/mutation.** File `use-<thing>.ts`. Hooks read from `shared/` (fetchers + keys). No inline `queryClient.fetchQuery` or fetcher imports inside components.
8. **Page owns state.** URL/UI state (filters, selection, drawers) lives in `<surface>-page.tsx`. Hooks consume props. Children are dumb where possible.
9. **i18n via paraglide `m.*`.** Zero string literals in JSX outside stable code/IDs/aria values. Label functions for enums in `types.ts`.
10. **Barrel `index.ts` exports only what cross-feature consumers import.** Internal moves don't update the barrel.
11. **Tests live next to code** in `__tests__/`. Fixtures in `__fixtures__/`. Mock fetchers, not React Query.
12. **Polling**: `refetchInterval` + `staleTime` + `networkMode: "online"` + `refetchIntervalInBackground: false`. Document the interval at the hook.

## Companion skills

Frontend-feature-architecture defines *where code lives*; the skills below define *how code reads*. Before writing component code, invoke applicable skills below.

| Skill | Trigger | Why |
|---|---|---|
| `vercel-react-best-practices` | New/edit component, hook, data fetch | Performance: waterfalls, bundle, re-renders |
| `vercel-composition-patterns` | ≥3 boolean props, reusable API, compound shapes | Component API design |
| `vercel-react-view-transitions` | Route/page/list animation | View transitions |
| `paraglide-js` | Any user-facing string | i18n via `m.*` |
| `shadcn` | Picking/wiring `@/shared/ui/*` primitives | Component registry |
| `web-design-guidelines` | UI review, accessibility, layout audit | A11y + UX patterns |
| `es-toolkit` | Utility/array/object/string operations | Replace native/custom utils |

Skip vercel-* skills for `packages/server`, `packages/shared`, `packages/plugins/*`.

## References

- [`folder-layout.md`](references/folder-layout.md) — flat vs split, file naming, promotion rules
- [`data-layer.md`](references/data-layer.md) — Hono client, fetchers, error class, query-keys factory
- [`react-query.md`](references/react-query.md) — Suspense reads, optimistic mutations recipe, polling, infinite queries
- [`composition.md`](references/composition.md) — page → list → row, Suspense + ErrorBoundary placement, density/intensity
- [`i18n-and-tokens.md`](references/i18n-and-tokens.md) — paraglide `m.*`, label functions, META maps, design tokens
- [`checklist.md`](references/checklist.md) — new-feature and retrofit checklists
- [`examples/new-feature-flat.md`](references/examples/new-feature-flat.md)
- [`examples/new-feature-split.md`](references/examples/new-feature-split.md)

## Workflow

1. Read decision tree → pick layout.
2. Skim hard rules.
3. Open the right reference for the section you're touching (data layer, react-query, composition, i18n).
4. Invoke companion skills.
5. Cross-check against `apps/client/src/features/home/` for flat single-surface layout, or `apps/client/src/features/notifications/` for split multi-surface layout.
6. Run new-feature or retrofit checklist before opening PR.
