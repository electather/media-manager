# Checklists

## New feature

- [ ] Pick layout (flat vs split) — see [`folder-layout.md`](folder-layout.md).
- [ ] Create folder + `index.ts` barrel (export only cross-feature surfaces).
- [ ] `query-keys.ts` factory — hierarchical, filters as discriminator, `<thing>All()` helpers.
- [ ] `fetchers.ts` — Hono `api.*` only, single `throwOnError` helper.
- [ ] `types.ts` — DTOs, typed `<Feature>ApiError`, filter interfaces, label fns, META maps.
- [ ] `error-boundary.tsx` — resets feature keys on retry.
- [ ] Page wraps consumer in `<Suspense fallback={<Skeleton/>}>` + `<FeatureErrorBoundary>`.
- [ ] Hooks: one per query/mutation, `use-<x>.ts`, read from shared.
- [ ] Suspense reads (`useSuspenseQuery` / `useSuspenseInfiniteQuery`) for primary data.
- [ ] `useQuery` only for polling/optional/non-blocking.
- [ ] Mutations optimistic for user-perceived state (cancel → snapshot → patch → restore → invalidate).
- [ ] Polling: `refetchInterval` + `staleTime` + `networkMode:"online"` + `refetchIntervalInBackground:false`. Document interval.
- [ ] All strings via `m.*`. Label fns for enums. META maps for icons/tokens.
- [ ] Tests in `__tests__/`, fixtures in `__fixtures__/`. Mock fetchers, not React Query.
- [ ] Companion skills invoked: `vercel-react-best-practices`, `vercel-composition-patterns` (when ≥3 bool props), `shadcn`, `paraglide-js`, `web-design-guidelines`, `es-toolkit`, `vercel-react-view-transitions` (route/list anim).
- [ ] Changeset added (per `apps/client/CLAUDE.md` rules).
- [ ] `vp check` + `vp test` clean.

## Retrofit

- [ ] Inventory: list current files; map to flat or split layout.
- [ ] Replace raw `fetch()` w/ Hono `api.*`. If route missing, file server change in same PR or block.
- [ ] Collect API calls into `fetchers.ts`. Add `throwOnError` + typed `<Feature>ApiError`.
- [ ] Convert ad-hoc query-key arrays → `<feature>Keys` factory. Verify all invalidations match new keys.
- [ ] Add `error-boundary.tsx`; wrap page in it + `<Suspense>`.
- [ ] Switch primary `useQuery` → `useSuspenseQuery` / `useSuspenseInfiniteQuery`.
- [ ] Promote user-perceived mutations to optimistic pattern.
- [ ] Move components/hooks into surface folders if 2+ surfaces; keep flat otherwise.
- [ ] Update `index.ts` barrel; delete now-unused re-exports.
- [ ] Update internal imports to absolute (`@/features/<x>/...`) or keep relative — match feature convention.
- [ ] `vp check` + `vp test` — no consumer breakage.
- [ ] Changeset (internal-only: empty frontmatter + body).

## PR review

When reviewing a feature-folder PR, cite hard-rule numbers from [`SKILL.md`](../SKILL.md).

- [ ] Rule 1 — no raw `fetch` in `features/**`.
- [ ] Rule 2 — fetchers centralized.
- [ ] Rule 3 — typed error class used in ErrorBoundary.
- [ ] Rule 4 — query-keys factory only.
- [ ] Rule 5 — Suspense reads at page; ErrorBoundary present.
- [ ] Rule 6 — optimistic mutations for user-perceived state.
- [ ] Rule 7 — one hook per query/mutation, no inline fetcher imports in components.
- [ ] Rule 8 — page owns state.
- [ ] Rule 9 — `m.*` for strings.
- [ ] Rule 10 — barrel discipline.
- [ ] Rule 11 — tests next to code, mock fetchers.
- [ ] Rule 12 — polling pattern complete.

## See also

- [`SKILL.md`](../SKILL.md) — hard rules.
- Reference dives: [`folder-layout.md`](folder-layout.md), [`data-layer.md`](data-layer.md), [`react-query.md`](react-query.md), [`composition.md`](composition.md), [`i18n-and-tokens.md`](i18n-and-tokens.md).
