# Frontend Feature Architecture Skill — Design

**Status:** Draft
**Date:** 2026-05-07
**Author:** Omid Astaraki
**Scope:** `apps/client/src/features/*` only. `apps/server`, `packages/shared`, `packages/plugin-sdk`, `packages/plugins/*` out of scope.
**Related:** [`2026-04-29-frontend-structure-design.md`](./2026-04-29-frontend-structure-design.md), [`2026-05-06-notifications-client-design.md`](./2026-05-06-notifications-client-design.md)

## Summary

Codify the architecture used by `apps/client/src/features/notifications/` as a Claude skill at `.agents/skills/frontend-feature-architecture/`, symlinked into `.claude/skills/`. Skill auto-loads when agents touch `apps/client/src/features/**`. Notifications stays the canonical living example. The skill prescribes folder layout (flat vs surfaces+shared), data layer (Hono `api.*` client, query-keys factory, typed error class), React Query rules (Suspense reads, optimistic mutations, polling), and composition (page → list → row, Suspense + ErrorBoundary placement). Companion skills (`vercel-react-best-practices`, `vercel-composition-patterns`, `vercel-react-view-transitions`, `paraglide-js`, `shadcn`, `web-design-guidelines`, `es-toolkit`) are referenced, not duplicated. Rolls in a one-PR retrofit of `features/home` to align it with the template.

The frontend-structure design (2026-04-29) establishes folder-level boundaries between `app/`, `features/`, and `shared/`. This skill extends that work with per-feature internal architecture: how a feature is laid out, how it talks to the API, and how it uses React Query.

## Goals

- One source of truth for "how a `features/<x>/` module is built."
- Auto-applied via Claude skill so agents reach for it before scaffolding new features or editing existing ones.
- Keep notifications as the live reference; skill points to real files, not frozen copies.
- Make non-conforming code visible: a clear diff exists between aligned features (notifications) and drifted ones (home).
- Compose with existing Vercel/paraglide/shadcn skills instead of restating their rules.

## Non-goals

- Restructuring `app/`, `shared/`, or `routes/`. The 2026-04-29 design owns those.
- Server, shared package, or plugin SDK conventions.
- Mandatory codemods or scaffold scripts. Doc + canonical example only.
- Lint/eslint enforcement of these rules. Possible future iteration; not in this design.
- Retrofitting every drifted feature in one shot. Scope here = home only.

## Skill artifact

### Location

```
.agents/skills/frontend-feature-architecture/
├── SKILL.md
├── references/
│   ├── folder-layout.md
│   ├── data-layer.md
│   ├── react-query.md
│   ├── composition.md
│   ├── i18n-and-tokens.md
│   ├── checklist.md
│   └── examples/
│       ├── new-feature-flat.md
│       └── new-feature-split.md
└── metadata.json
```

`.claude/skills/frontend-feature-architecture` symlinks to `../../.agents/skills/frontend-feature-architecture` to match the existing pattern (`backprop`, `frontend-design`, `paraglide-js`, etc.).

### `SKILL.md` shape

`SKILL.md` is short (~150–200 lines): rules digest, decision tree, companion-skill index, links into `references/`. Detail lives in references so the main file stays scannable when auto-loaded.

Frontmatter:

```yaml
---
name: frontend-feature-architecture
description: Standard architecture for apps/client/src/features/* modules. Use when creating a new feature, retrofitting an existing feature, or reviewing feature-folder PRs. Covers folder layout (flat vs surfaces+shared), data layer (Hono api.* client, query-keys factory, typed error class), React Query rules (Suspense reads, optimistic mutations, polling), and composition (page → list → row, Suspense + ErrorBoundary placement). Notifications is the canonical example.
metadata:
  version: "1.0.0"
---
```

Top-of-file table of contents:

1. Decision tree (flat vs split)
2. Hard rules (numbered)
3. Companion skills (which to invoke when)
4. Section index (links into `references/`)
5. Canonical example pointer: `apps/client/src/features/notifications/`

## Decision tree (flat vs split)

```
new feature?
├─ 1 surface (single page or single widget; no admin variant)
│   └─ flat layout
│       features/<name>/
│       ├── index.ts
│       ├── components/
│       ├── hooks/
│       ├── lib/      # types, helpers, fetchers, query-keys
│       └── __tests__/
│
└─ 2+ surfaces (e.g. user page + admin page, or page + popover widget)
    └─ split layout
        features/<name>/
        ├── index.ts
        ├── shared/
        │   ├── fetchers.ts
        │   ├── query-keys.ts
        │   ├── types.ts            # DTOs, error class, label fns, META maps
        │   ├── error-boundary.tsx
        │   └── <atom>.tsx          # cross-surface presentational atoms
        └── <surface>/              # one folder per surface
            ├── <surface>-page.tsx
            ├── use-<x>.ts
            ├── <surface>-skeleton.tsx
            ├── <surface>-empty.tsx
            ├── <component>.tsx
            └── __tests__/, __fixtures__/
```

Promotion: flat features that grow a second surface promote to split. Demotion: split features that lose a surface stay split (cost of moving things back outweighs benefit).

## Hard rules

Each rule is numbered so review comments and PR descriptions can cite them.

1. **Hono client only.** Fetchers MUST go through `api.*` from `@/shared/lib/api`. No raw `fetch()` in `features/**`. Exception: streaming/SSE/uploads — document inline with a comment that names the constraint.
2. **Centralized fetchers.** All API calls live in `<feature>/shared/fetchers.ts` (split) or `<feature>/lib/fetchers.ts` (flat). Each fetcher is a thin wrapper that on `!res.ok` calls a shared `throwOnError` helper that builds a typed error. No fetch logic inside hooks or components.
3. **Typed error class.** One `<Feature>ApiError extends Error` per feature in `types.ts`, carrying `status`, `body`, `code`. The feature ErrorBoundary fallback reads typed fields rather than parsing strings.
4. **Query-keys factory.** Hierarchical const object: `<feature>Keys.all`, `.x()`, `.x(filters)`, with nested groups for sub-areas (e.g. `.admin.x()`). Filters are part of the key. Ad-hoc `["foo", "bar"]` arrays at call sites are forbidden.
5. **Suspense reads.** `useSuspenseQuery` / `useSuspenseInfiniteQuery` for primary fetches. The page wraps consumer components in `<Suspense fallback={<Skeleton/>}>` plus the feature `ErrorBoundary`. `useQuery` is reserved for polling, optional, or non-blocking data.
6. **Optimistic mutations** for user-perceived state (toggles, mark-read, dismiss, edit). Pattern: cancel queries → snapshot → `setQueriesData` patch → return ctx → `onError` restore → `onSettled` invalidate. Heuristic: if the user clicks the thing and waits more than ~100ms before a UI update, the mutation must be optimistic. Invalidate-only is acceptable for low-stakes background ops (e.g. retention save).
7. **One hook per query/mutation.** File `use-<thing>.ts`. Hooks read from `shared/` (fetchers + keys). No inline `queryClient.fetchQuery` or fetcher imports inside components.
8. **Page owns state.** URL/UI state (filters, selection, open drawers) lives in `<surface>-page.tsx`. Hooks consume props. Children are dumb where possible.
9. **i18n via paraglide `m.*`.** Zero string literals in JSX outside `<code>`/IDs/aria values that are stable. Label functions for enums in `types.ts`.
10. **Barrel `index.ts` exports only what cross-feature consumers import.** Internal moves don't update the barrel.
11. **Tests live next to code** in `__tests__/`. Fixtures in `__fixtures__/`. Mock fetchers, not React Query itself.
12. **Polling pattern**: `refetchInterval` + `staleTime` + `networkMode: "online"` + `refetchIntervalInBackground: false`. Document the interval at the hook.

## Companion skills

| Skill | Trigger | Why |
|---|---|---|
| `vercel-react-best-practices` | New/edit component, hook, data fetch | Performance: waterfalls, bundle, re-renders |
| `vercel-composition-patterns` | ≥3 boolean props, reusable API, compound shapes | Component API design |
| `vercel-react-view-transitions` | Route/page/list animation | View transitions |
| `paraglide-js` | Any user-facing string | i18n via `m.*` |
| `shadcn` | Picking/wiring `@/shared/ui/*` primitives | Component registry |
| `web-design-guidelines` | UI review, accessibility, layout audit | A11y + UX patterns |
| `es-toolkit` | Utility/array/object/string operations | Replace native/custom utils |

Rule placed near the top of `SKILL.md`: "frontend-feature-architecture defines *where code lives*; vercel/shadcn/paraglide define *how code reads*. Before writing component code, the agent invokes applicable skills above."

The list lives in `SKILL.md` only (single source). Each `references/*.md` ends with a "See also" pointer back to the SKILL.md companion section, not its own list.

Skip companion `vercel-*` skills for `packages/server`, `packages/shared`, `packages/plugins/*` — mirrors the existing CLAUDE.md guidance.

## References (detail files)

### `references/folder-layout.md`

- Tiered decision tree (flat vs split), with the diagrams above.
- File naming: `use-<x>.ts`, `<surface>-page.tsx`, `<surface>-skeleton.tsx`, `<surface>-empty.tsx`, kebab-case for component files.
- Where each kind of file goes (types/fetchers/keys/error-boundary/atoms in `shared/` vs `lib/`; surface-only components in surface folder).
- When to promote a flat feature to split.

### `references/data-layer.md`

- Mandate for Hono `api.*` client; rationale (end-to-end types).
- Fetchers shape: thin wrappers, single `throwOnError`, typed error class.
- Error class shape: `status`, `body`, `code`; how the error boundary reads it.
- Query-keys factory shape; cite `notifications/shared/query-keys.ts` line numbers.

### `references/react-query.md`

- Suspense reads vs `useQuery` decision.
- Polling recipe (interval, staleTime, networkMode, refetchIntervalInBackground).
- Infinite queries (cursor, `getNextPageParam`).
- Optimistic mutation recipe with code snippets pulled from `notifications/inbox/use-inbox-mutations.ts` (cancelQueries → snapshot → patch → restore → invalidate).
- Invalidation patterns: `inboxAll()` parent key, prefix-matched.
- "See also: `vercel-react-best-practices`."

### `references/composition.md`

- Page → list → row layering. Page owns state; list owns virtualizer + Suspense data fetch; row is presentational.
- Suspense + ErrorBoundary placement.
- Density/intensity prop pattern (cite `notifications/shared/types.ts` `Density`/`Intensity`).
- "See also: `vercel-composition-patterns`."

### `references/i18n-and-tokens.md`

- All strings via `m.*`.
- Enum label functions in `types.ts`.
- META maps for icons/colors (`CATEGORY_META`, `SEVERITY_META`).
- Tailwind tokens, no inline arbitrary colors.
- "See also: `paraglide-js`, `shadcn`, `web-design-guidelines`."

### `references/checklist.md`

Two checklists: new feature and retrofit. Reproduced in this design under "Checklists" below.

### `references/examples/new-feature-flat.md`

Markdown example with code fences (not real `.ts` files — avoids drift). Walks through a hypothetical 1-surface `widgets` feature. Approximate skeleton:

```ts
// features/widgets/lib/query-keys.ts
export const widgetsKeys = {
  all: ["widgets"] as const,
  list: (filters: WidgetFilters) => [...widgetsKeys.all, "list", filters] as const,
  detail: (id: string) => [...widgetsKeys.all, "detail", id] as const,
} as const;

// features/widgets/lib/fetchers.ts
import { api } from "@/shared/lib/api";
import { safeJson } from "@/shared/lib/errors/safe-json";
import { WidgetsApiError, type WidgetFilters, type WidgetsApiErrorBody } from "./types";

async function throwOnError(res: Response): Promise<never> {
  const body = (await safeJson(res)) as WidgetsApiErrorBody | null;
  throw new WidgetsApiError(res.status, body);
}

export async function fetchWidgets(filters: WidgetFilters) {
  const res = await api.widgets.$get({ query: filters });
  if (!res.ok) await throwOnError(res);
  return res.json();
}

// features/widgets/hooks/use-widgets.ts
export function useWidgets(filters: WidgetFilters) {
  return useSuspenseQuery({
    queryKey: widgetsKeys.list(filters),
    queryFn: () => fetchWidgets(filters),
  });
}

// features/widgets/components/widgets-page.tsx
export function WidgetsPage({ filters }: Props) {
  return (
    <WidgetsErrorBoundary>
      <Suspense fallback={<WidgetsSkeleton />}>
        <WidgetsList filters={filters} />
      </Suspense>
    </WidgetsErrorBoundary>
  );
}
```

### `references/examples/new-feature-split.md`

Markdown example mirroring `notifications`: `shared/{fetchers,query-keys,types,error-boundary}.ts` plus two surface folders with `use-*.ts` hooks and `<surface>-page.tsx`. Code excerpts pulled from notifications with the feature name swapped to `<feature>`.

## Checklists

### New feature

- [ ] Pick layout (flat vs split) per decision tree.
- [ ] Create folder + barrel `index.ts`.
- [ ] Add `query-keys.ts` factory.
- [ ] Add `fetchers.ts` with `throwOnError`; add typed error class in `types.ts`.
- [ ] Add `error-boundary.tsx` (resets feature keys on retry).
- [ ] Pages wrap consumer in `<Suspense>` and `<FeatureErrorBoundary>`.
- [ ] Hooks: one per query/mutation, named `use-<x>.ts`.
- [ ] Mutations: optimistic for user-perceived state (snapshot → patch → restore → invalidate).
- [ ] Polling: `refetchInterval` + `staleTime` + `networkMode: "online"` + `refetchIntervalInBackground: false`.
- [ ] All strings via paraglide `m.*`; label functions for enums in `types.ts`.
- [ ] Tests in `__tests__/`, fixtures in `__fixtures__/`, mock fetchers (not React Query).
- [ ] Companion skills invoked: `vercel-react-best-practices`, `vercel-composition-patterns` (when appropriate), `shadcn`, `paraglide-js`, `web-design-guidelines`, `es-toolkit`.
- [ ] Changeset added.

### Retrofit

- [ ] Inventory: list current files; map to flat or split layout.
- [ ] Replace raw `fetch` calls with Hono `api.*`; collect into `fetchers.ts`.
- [ ] Convert ad-hoc query-key arrays to `<feature>Keys` factory; verify all invalidations match the new keys.
- [ ] Add typed `<Feature>ApiError` and `throwOnError`; remove inline error parsing.
- [ ] Wrap pages in feature `ErrorBoundary` and `<Suspense>`; switch primary `useQuery` to `useSuspenseQuery`.
- [ ] Promote user-perceived mutations to the optimistic pattern.
- [ ] Move components/hooks into surface folders if 2+ surfaces (or keep flat).
- [ ] Update `index.ts` barrel; delete now-unused re-exports.
- [ ] Run `vp check` and `vp test`; verify no consumer breakage.
- [ ] Changeset (internal-only: empty frontmatter).

## Home retrofit notes

Home is the only feature in scope for retrofit in this design. Concrete plan:

- Files involved: `apps/client/src/features/home/hooks/use-home-feed.ts`, `use-home-row.ts`, `use-home-details.ts`.
- Layout: home is single-surface (one page) → use the flat layout (`components/`, `hooks/`, `lib/`, `__tests__/`). No `shared/` split.
- Replace raw `fetch('/api/home/layout', ...)` in `use-home-feed.ts` with `api.home.layout.$get(...)`. Confirm Hono route exists; if not, file a small server change in the same PR or block on it.
- Add `lib/query-keys.ts` with `homeKeys.all`, `homeKeys.layout()`, `homeKeys.row(rowId)`, `homeKeys.details(id)`.
- Replace ad-hoc `["home", "layout"]` array key with `homeKeys.layout()`.
- Add `lib/fetchers.ts` with `fetchHomeLayout`, `fetchHomeRow`, `fetchHomeDetails`; introduce `lib/types.ts` with `HomeApiError`.
- Add `lib/error-boundary.tsx`; wrap the home page in it.
- Switch `useHomeFeed` to `useSuspenseQuery` (page already has loading UX; verify Suspense boundary placement on the home route).
- Polling/staleness: keep current `staleTime`; document the chosen interval in a top-of-file comment.
- No mutation changes expected for home. If any are added later, they must follow the optimistic pattern.

The home retrofit is a separate PR from the skill PR.

## Delivery plan

Two PRs:

1. **Skill PR** — adds `.agents/skills/frontend-feature-architecture/` with `SKILL.md` + `references/`, plus `.claude/skills/frontend-feature-architecture` symlink. References notifications by file path. Internal-only changeset.
2. **Home retrofit PR** — applies the retrofit checklist to `features/home/`. End-user changeset only if behavior changes; otherwise internal-only.

Order: skill PR first so the retrofit PR can cite skill rules in its description.

## Risks and mitigations

- **Skill drift from notifications.** Mitigation: skill cites file paths, not snapshots. A check-list item in the notifications-touching PRs: "if the feature shape changed materially, update the skill."
- **Examples drifting from real code.** Mitigation: examples are markdown-only, generic feature names, deliberately not exhaustive. Real reference is notifications source.
- **Over-prescription stifling judgment.** Mitigation: "user-perceived state" heuristic is explicit (~100ms threshold). Decision tree allows flat layout for single-surface features.
- **Home retrofit blocked on missing Hono route.** Mitigation: scoping check before opening retrofit PR; defer or split if needed.

## Open questions

None blocking. Possible follow-ups (out of scope for this design):

- ESLint boundary rule (e.g., `eslint-plugin-boundaries`) banning raw `fetch` in `features/**`.
- Retrofit of `jobs`, `connections`, `request-flow`, `admin` as their next material change comes up.
- `vp run scaffold:feature <name>` script if frequent new features appear.
