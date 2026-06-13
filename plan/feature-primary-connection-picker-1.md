---
goal: Wire primary-connection picker (metadata@v1) to API + client UI
version: 1.0
date_created: 2026-05-22
last_updated: 2026-05-22
owner: Omid Astaraki
status: 'Planned'
tags: [feature, server, client, connections]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

Implement HTTP API + settings UI for the existing `primary_connections` service so users can pin which provider drives `metadata@v1` per `mediaType`. Backend service, DB table, and atomic upsert already exist; this plan wires them into Hono procedures and a new React card in `settings-connections`. Source spec: `docs/superpowers/specs/2026-05-22-primary-connection-picker-design.md`.

## 1. Requirements & Constraints

- **REQ-001**: `POST /api/connections/primary` accepts `{capabilityKey, mediaType, connectionId}` and atomically upserts the row.
- **REQ-002**: `DELETE /api/connections/primary` accepts `{capabilityKey, mediaType}` and removes the row (idempotent).
- **REQ-003**: `GET /api/connections/primary` returns `{ primaries: Array<{capabilityKey, mediaType, connectionId}> }` scoped to the calling user; sentinel `"_"` mapped to `null` on the wire.
- **REQ-004**: Picker card renders only when ≥2 eligible connections exist for at least one configured row; each row hidden when its own eligible list has <2.
- **REQ-005**: Picker writes invalidate the dispatcher's per-user capability cache.
- **REQ-006**: Picker shows two rows for v1: `(metadata@v1, "movie")` and `(metadata@v1, "tv")`.
- **REQ-007**: "Auto" option (clears row) appears first in dropdown; selecting it calls `DELETE /primary`.
- **REQ-008**: Disabled / non-`connected` connections never appear in the dropdown options.
- **SEC-001**: Endpoints sit behind `requireSession` + `requirePermission(PERMISSIONS.ACCOUNT_CONNECTIONS)` (inherited from `connectionsApp`).
- **SEC-002**: Server rejects writes when `connectionId` is not owned by the calling user (`404 connection.not_found`).
- **SEC-003**: Server rejects writes when the connection's plugin manifest does not advertise the requested `capabilityKey` as user-scoped (`422 connection.capability_unsupported`).
- **CON-001**: No DB schema change. `primary_connections` table already exists with composite PK on `(userId, capabilityKey, mediaType)`.
- **CON-002**: Pre-stable repo — no API compat shims required.
- **CON-003**: Adding `mediaType: null` ↔ sentinel `"_"` mapping happens in the service wrapper, not in callers.
- **GUD-001**: Follow `frontend-feature-architecture` for client work; primary-providers card lives inside existing `settings-connections` feature folder.
- **GUD-002**: Follow `backend-feature-architecture` for server work; primary-service wrapper lives in the `connections/` module.
- **GUD-003**: Reuse `useOptimisticArrayMutation` from `@/shared/hooks/use-optimistic-array-mutation` (same hook `use-toggle-enabled.ts` uses).
- **PAT-001**: Zod schemas for request bodies live in `packages/shared/src/connections/schemas.ts` and are imported by both server validators and client types.
- **PAT-002**: Capability key regex `^[a-z][a-zA-Z0-9]*@v\d+$` (no hyphens — none in current capability names).

## 2. Implementation Steps

### Implementation Phase 1 — Shared schemas

- GOAL-001: Add zod schemas + types for primary-connection endpoints to `@nama/shared/connections` so server validators and client fetchers share one source of truth.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Add `primaryConnectionSetSchema` and `primaryConnectionClearSchema` to `packages/shared/src/connections/schemas.ts`. Use `z.enum(MEDIA_TYPES).nullable()` for `mediaType`, `z.string().regex(/^[a-z][a-zA-Z0-9]*@v\d+$/)` for `capabilityKey`, `z.string().uuid()` for `connectionId`. Import `MEDIA_TYPES` from `../media/enums`. | ✅ | 2026-05-22 |
| TASK-002 | Export `PrimaryConnectionRow` interface in `packages/shared/src/connections/types.ts`: `{ capabilityKey: string; mediaType: "movie" \| "tv" \| null; connectionId: string }`. | ✅ | 2026-05-22 |
| TASK-003 | Re-export new schemas + type via `packages/shared/src/connections/index.ts`. | ✅ | 2026-05-22 |

### Implementation Phase 2 — Server: extract `requireConnection`

- GOAL-002: Promote `requireConnection` from private (inside `apps/server/src/connections/service.ts`) to an exported helper so the new primary service can reuse the ownership check without duplicating the lookup or 404 mapping.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-004 | Move `requireConnection` from `apps/server/src/connections/service.ts:105` to `apps/server/src/connections/helpers.ts` as a named export. Signature unchanged: `(db: Db, connectionId: string, userId: string)`. Keep callers in `service.ts` working by importing from the local `./helpers`. | ✅ | 2026-05-22 |
| TASK-005 | Add a unit test in `apps/server/src/connections/__tests__/helpers.require-connection.test.ts` covering (a) returns row when owner matches, (b) throws `notFound("connection.not_found")` when row is missing, (c) throws `notFound("connection.not_found")` when row belongs to a different user. | ✅ | 2026-05-22 |

### Implementation Phase 3 — Server: primary-service wrapper

- GOAL-003: Add `primaryConnectionsService` that enforces ownership + capability checks, then delegates to existing `primary-preference.ts` and invalidates user cache.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-006 | Create `apps/server/src/connections/primary-service.ts` exporting `primaryConnectionsService` with three methods: `listForUser(userId)`, `set({userId, capabilityKey, mediaType, connectionId})`, `clear({userId, capabilityKey, mediaType})`. | ✅ | 2026-05-22 |
| TASK-007 | `listForUser` selects `(capabilityKey, mediaType, connectionId)` from `primaryConnections` where `userId` matches, maps sentinel `"_"` → `null`, returns `PrimaryConnectionRow[]`. | ✅ | 2026-05-22 |
| TASK-008 | `set` performs: (1) `requireConnection(db, connectionId, userId)`, (2) capability advertisement check using `capabilityRegistry.get(pluginId)?.capabilities` — throw `unprocessable("connection.capability_unsupported", ...)` if the manifest doesn't list `capabilityKey` at user scope, (3) call `setPrimaryConnection(...)`, (4) call `invalidateUserCache(userId)`. | ✅ | 2026-05-22 |
| TASK-009 | `clear` performs: (1) call `clearPrimaryConnection(...)`, (2) call `invalidateUserCache(userId)`. No ownership check needed (deleting a row by `(userId, capabilityKey, mediaType)` is scoped to the caller). | ✅ | 2026-05-22 |
| TASK-010 | Co-locate a small internal helper `assertOwnedAndSupportsCapability(args)` inside the same file to keep `set` readable. Function returns the resolved `pluginId` for the connection so the capability check has the data it needs. | ✅ | 2026-05-22 |

### Implementation Phase 4 — Server: HTTP procedures

- GOAL-004: Add the new Hono sub-app and mount it under `connectionsApp` at `/primary`.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-011 | Create `apps/server/src/api/procedures/connections-primary.ts` exporting `connectionsPrimaryApp = new Hono()` with `.get("/")`, `.post("/", zValidator("json", primaryConnectionSetSchema), ...)`, `.delete("/", zValidator("json", primaryConnectionClearSchema), ...)`. Use `sessionUserId(c)` to read caller. | ✅ | 2026-05-22 |
| TASK-012 | Wire the sub-app: in `apps/server/src/api/procedures/connections.ts`, add `.route("/primary", connectionsPrimaryApp)` to `connectionsApp` (after the existing chained handlers). The parent's `requireSession` + `requirePermission(PERMISSIONS.ACCOUNT_CONNECTIONS)` middleware applies automatically. | ✅ | 2026-05-22 |
| TASK-013 | Confirm Hono RPC types regenerate cleanly so `api.connections.primary.$get/$post/$delete` resolve on the client. Run `vp check` to verify. | ✅ | 2026-05-22 |

### Implementation Phase 5 — Server tests

- GOAL-005: Procedure-level integration tests + strategy regression.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-014 | Create `apps/server/src/api/procedures/__tests__/connections-primary.test.ts` covering: unauthenticated → 401, missing permission → 403, foreign `connectionId` → 404 `connection.not_found`, unsupported capability → 422 `connection.capability_unsupported`, happy `POST` → row upserted + `invalidateUserCache` called, double-`POST` with different `connectionId` → second wins (#458 regression in API form), happy `DELETE` → row removed + `invalidateUserCache` called, `DELETE` on missing row → 200, `GET` returns rows scoped to caller with sentinel `"_"` → `null` mapping. | ✅ | 2026-05-22 |
| TASK-015 | Extend `apps/server/src/media/__tests__/primary-with-enrichment.test.ts` with one case: two providers `[A, B]` + `setPrimaryConnection` pinning the B-backed connection results in candidates ordered `[B, A]`. | ✅ | 2026-05-22 |

### Implementation Phase 6 — Client: shared helpers

- GOAL-006: Add fetchers, query key, and the static row list.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-016 | Add `primary: () => [...settingsConnectionsKeys.all, "primary"] as const` to `apps/client/src/features/settings-connections/lib/query-keys.ts`. | ✅ | 2026-05-22 |
| TASK-017 | Add three fetchers in `apps/client/src/features/settings-connections/lib/fetchers.ts`: `fetchPrimaryConnections()` (calls `api.connections.primary.$get()`), `fetchSetPrimaryConnection(input)` (calls `$post({ json: input })`), `fetchClearPrimaryConnection(input)` (calls `$delete({ json: input })`). All wrap with `readJson` + `SettingsConnectionsApiError`. | ✅ | 2026-05-22 |
| TASK-018 | Create `apps/client/src/features/settings-connections/lib/primary-rows.ts` exporting `PRIMARY_PROVIDER_ROWS` array of two entries `{ capabilityKey: "metadata@v1", mediaType: "movie" \| "tv", labelMessage }`. Labels come from new paraglide messages. | ✅ | 2026-05-22 |
| TASK-019 | Add paraglide messages: `settings_connections_primary_section_title`, `settings_connections_primary_section_description`, `settings_connections_primary_movies_label`, `settings_connections_primary_tv_label`, `settings_connections_primary_auto_option`, `settings_connections_primary_auto_was_option` (param `name`). | ✅ | 2026-05-22 |

### Implementation Phase 7 — Client: hooks

- GOAL-007: Suspense read + optimistic write hooks.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-020 | Create `apps/client/src/features/settings-connections/hooks/use-primary-connections.ts` exporting `usePrimaryConnections()` using `useSuspenseQuery({ queryKey: settingsConnectionsKeys.primary(), queryFn: fetchPrimaryConnections })`. | ✅ | 2026-05-22 |
| TASK-021 | Create `apps/client/src/features/settings-connections/hooks/use-set-primary-connection.ts` using `useOptimisticArrayMutation<PrimaryConnectionRow, {capabilityKey; mediaType; connectionId}>` with `queryKey: settingsConnectionsKeys.primary()`. `update` callback replaces the row matching `(capabilityKey, mediaType)` or appends when none exists. | ✅ | 2026-05-22 |
| TASK-022 | Create `apps/client/src/features/settings-connections/hooks/use-clear-primary-connection.ts` using `useOptimisticArrayMutation<PrimaryConnectionRow, {capabilityKey; mediaType}>`. `update` callback filters out the row matching `(capabilityKey, mediaType)`. | ✅ | 2026-05-22 |

### Implementation Phase 8 — Client: components

- GOAL-008: Render the new card on the settings-connections page.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-023 | Create `apps/client/src/features/settings-connections/components/primary-providers-card.tsx` exporting `PrimaryProvidersCard`. Component reads `useConnections()` + `usePrimaryConnections()`; computes per-row `eligible` list (filter `enabled && status === "connected" && plugin.userScopedCapabilities` advertises `capabilityKey`); returns `null` if no row has ≥2 eligible. Otherwise wraps rows in a `SettingsCard`. | ✅ | 2026-05-22 |
| TASK-024 | Inside `PrimaryProvidersCard`, render a `PrimaryProviderRow` child for each row whose own eligible list has ≥2 entries. Child uses shadcn `<Select>` with first item value `__auto__` (label from `settings_connections_primary_auto_option`), then one item per eligible connection (label = `displayName \|\| plugin.name`). When current pinned connection is no longer eligible, prepend an "Auto (was X)" item to communicate the state — handled inside the row component. | ✅ | 2026-05-22 |
| TASK-025 | On select change: value `__auto__` → call `useClearPrimaryConnection().mutate({ capabilityKey, mediaType })`; any other value → call `useSetPrimaryConnection().mutate({ capabilityKey, mediaType, connectionId: value })`. Show `toast.error(...)` on mutation error (rollback handled by `useOptimisticArrayMutation`). | ✅ | 2026-05-22 |
| TASK-026 | Mount `<PrimaryProvidersCard>` inside `apps/client/src/features/settings-connections/components/settings-connections-page.tsx`, above the existing connection cards list, wrapped in `<Suspense>` + `<SettingsErrorBoundary>` matching the pattern used by sibling cards on that page. | ✅ | 2026-05-22 |

### Implementation Phase 9 — Client tests

- GOAL-009: Component-level tests for the new card.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-027 | Create `apps/client/src/features/settings-connections/__tests__/primary-providers-card.test.tsx` covering: (a) renders nothing when only 1 eligible connection per capability, (b) renders both rows when ≥2 eligible exist for `metadata@v1`, (c) selecting a connection fires `POST /primary` with correct body, (d) selecting "Auto" fires `DELETE /primary`, (e) optimistic update rolls back on 5xx, (f) disabled connections do not appear in dropdown options, (g) previously-pinned connection that became ineligible renders "Auto (was X)" option label and clears cleanly when user picks a real connection. | ✅ | 2026-05-22 |

### Implementation Phase 10 — Verify + changeset

- GOAL-010: Repo-level checks + changesets.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-028 | Run `vp install`, then `vp check` and `vp test` until clean. | ✅ | 2026-05-22 |
| TASK-029 | Add `.changeset/<slug>.md` with `"@nama/server": minor` + `"@nama/client": minor` frontmatter. Body: "Added a picker for choosing which provider drives metadata details per media type." | ✅ | 2026-05-22 |
| TASK-030 | Open PR; link to issue #476 and the spec under `docs/superpowers/specs/2026-05-22-primary-connection-picker-design.md`. | ✅ | 2026-05-22 |

## 3. Alternatives

- **ALT-001**: Hard-code endpoints as `/connections/primary/metadata` with mediaType-only body. Rejected — discards the `(capabilityKey, mediaType)` generality the DB schema already pays for, and a second `primary_with_enrichment` capability would force an API rewrite.
- **ALT-002**: Fully generic client that discovers eligible capabilities by probing manifests for `primary_with_enrichment`. Rejected — added code complexity for zero current benefit; one consumer today, future capability = append a row to `PRIMARY_PROVIDER_ROWS`.
- **ALT-003**: Surface picker inline on each connection card. Rejected — primary selection is cross-plugin, so it surfaces redundantly on N cards and clutters per-connection UI.
- **ALT-004**: Always show picker, with empty / single-connection states. Rejected per user pick — picker is meaningless without ≥2 choices, so hide rather than render no-op control.

## 4. Dependencies

- **DEP-001**: `@nama/shared/connections` package — extending `schemas.ts`, `types.ts`, `index.ts`.
- **DEP-002**: Existing server modules: `connections/service.ts`, `connections/helpers.ts`, `media/service/primary-preference.ts`, `media` barrel (`invalidateUserCache`), `plugin-runtime` barrel (`capabilityRegistry`), `diagnostics/http-errors.ts` (`notFound`, `unprocessable`), `diagnostics/validator.ts` (`zValidator`), `auth` barrel (`sessionUserId`, `PERMISSIONS`, `requirePermission`, `requireSession`).
- **DEP-003**: Existing client modules: `@/shared/hooks/use-optimistic-array-mutation`, `@/shared/ui/select` (shadcn), `@/shared/ui/skeleton`, `@/shared/components/settings-error-boundary`, `@/features/settings` (`SettingsCard`, `SettingsCardHeader`), `@/shared/lib/api`, `@/shared/lib/api/throw-on-error`, paraglide messages.
- **DEP-004**: Atomic upsert in `setPrimaryConnection` (commit `330b2189`) — required so optimistic writes are race-safe; already merged.

## 5. Files

- **FILE-001**: `packages/shared/src/connections/schemas.ts` — extend with `primaryConnectionSetSchema`, `primaryConnectionClearSchema`.
- **FILE-002**: `packages/shared/src/connections/types.ts` — add `PrimaryConnectionRow`.
- **FILE-003**: `packages/shared/src/connections/index.ts` — re-export new symbols.
- **FILE-004**: `apps/server/src/connections/helpers.ts` — move + export `requireConnection`.
- **FILE-005**: `apps/server/src/connections/service.ts` — change `requireConnection` consumers to import from `./helpers`.
- **FILE-006**: `apps/server/src/connections/primary-service.ts` — NEW, primary-connection wrapper service.
- **FILE-007**: `apps/server/src/api/procedures/connections-primary.ts` — NEW, Hono sub-app for primary endpoints.
- **FILE-008**: `apps/server/src/api/procedures/connections.ts` — mount the sub-app via `.route("/primary", connectionsPrimaryApp)`.
- **FILE-009**: `apps/server/src/connections/__tests__/helpers.require-connection.test.ts` — NEW.
- **FILE-010**: `apps/server/src/api/procedures/__tests__/connections-primary.test.ts` — NEW.
- **FILE-011**: `apps/server/src/media/__tests__/primary-with-enrichment.test.ts` — extend with regression case.
- **FILE-012**: `apps/client/src/features/settings-connections/lib/query-keys.ts` — add `primary()` key.
- **FILE-013**: `apps/client/src/features/settings-connections/lib/fetchers.ts` — add 3 fetchers.
- **FILE-014**: `apps/client/src/features/settings-connections/lib/primary-rows.ts` — NEW, static row list.
- **FILE-015**: `apps/client/src/features/settings-connections/hooks/use-primary-connections.ts` — NEW.
- **FILE-016**: `apps/client/src/features/settings-connections/hooks/use-set-primary-connection.ts` — NEW.
- **FILE-017**: `apps/client/src/features/settings-connections/hooks/use-clear-primary-connection.ts` — NEW.
- **FILE-018**: `apps/client/src/features/settings-connections/components/primary-providers-card.tsx` — NEW.
- **FILE-019**: `apps/client/src/features/settings-connections/components/settings-connections-page.tsx` — mount `<PrimaryProvidersCard>`.
- **FILE-020**: `apps/client/src/features/settings-connections/__tests__/primary-providers-card.test.tsx` — NEW.
- **FILE-021**: Paraglide message catalog files (`apps/client/messages/<locale>.json` or generated source of truth) — add 6 new keys.
- **FILE-022**: `.changeset/<slug>.md` — NEW.

## 6. Testing

- **TEST-001**: `requireConnection` unit test — owner-match returns row; missing row throws `notFound`; foreign-owner row throws `notFound`.
- **TEST-002**: `POST /connections/primary` — 401 without session; 403 without `ACCOUNT_CONNECTIONS`; 404 with foreign `connectionId`; 422 with unsupported capability; 200 on happy path with `invalidateUserCache` called.
- **TEST-003**: `POST /connections/primary` — double-write with different `connectionId` → second wins (#458 regression in API form).
- **TEST-004**: `DELETE /connections/primary` — 200 on existing row + `invalidateUserCache` called; 200 on missing row (idempotent).
- **TEST-005**: `GET /connections/primary` — returns only caller's rows; sentinel `"_"` mapped to `null`; foreign rows excluded.
- **TEST-006**: `primary-with-enrichment.test.ts` — explicit primary moves chosen plugin to the front of `invokeAll` candidates.
- **TEST-007**: `<PrimaryProvidersCard>` — renders nothing with single eligible connection; both rows render with ≥2 eligible.
- **TEST-008**: `<PrimaryProvidersCard>` — picking a connection fires `POST /primary` with correct body; picking "Auto" fires `DELETE`.
- **TEST-009**: `<PrimaryProvidersCard>` — optimistic update rolls back on 5xx.
- **TEST-010**: `<PrimaryProvidersCard>` — disabled connections never appear in dropdown options.
- **TEST-011**: `<PrimaryProvidersCard>` — previously-pinned connection that became ineligible renders "Auto (was X)" label and clears cleanly when user picks any other option.

## 7. Risks & Assumptions

- **RISK-001**: Promoting `requireConnection` from private to exported widens the `connections` module's public surface. Mitigation: existing callers stay in-module; the new caller (`primary-service.ts`) is also in-module, so it's a same-module re-export rather than a cross-module leak.
- **RISK-002**: `useOptimisticArrayMutation` assumes the cache shape is an array. `GET /primary` returns `{ primaries: [...] }`; the fetcher unwraps to the array before storing under `settingsConnectionsKeys.primary()`. Same pattern as `useConnections`. Mitigation: enforce by typing in `usePrimaryConnections`.
- **RISK-003**: Capability key regex `^[a-z][a-zA-Z0-9]*@v\d+$` silently rejects hyphenated names. No hyphenated capabilities exist today (`metadata@v1`, `artwork@v1`, etc. all match), but a future hyphenated key would 422 at this layer. Mitigation: documented as a known constraint; loosen the regex if/when a hyphenated capability lands.
- **RISK-004**: Cache invalidation race — `invalidateUserCache` runs after `setPrimaryConnection`, but a concurrent dispatch reading the old cache could complete in between. Acceptable: the cache TTL bounds staleness and the next dispatch reads the new value. Documented in spec §6.
- **ASSUMPTION-001**: `capabilityRegistry.get(pluginId)?.capabilities` exposes the capability list in a shape usable for advertisement checks. Verified against current `plugin-runtime` registry implementation.
- **ASSUMPTION-002**: Hono RPC types regenerate cleanly when the sub-app is mounted, so the client gets `api.connections.primary.*` without manual type edits.
- **ASSUMPTION-003**: Two paraglide locales (the current set) need the six new message keys; CI will fail if any locale is missing them. Plan adds keys to all locales in TASK-019.

## 8. Related Specifications / Further Reading

- Issue: [#476 — Wire primary-connection picker (metadata@v1) to API + client UI](https://github.com/electather/nama/issues/476)
- Spec: `docs/superpowers/specs/2026-05-22-primary-connection-picker-design.md`
- Related issue: [#458 — race in `setPrimaryConnection`](https://github.com/electather/nama/issues/458) (fixed in commit `330b2189`)
- Existing service: `apps/server/src/media/service/primary-preference.ts`
- Strategy that consumes the value: `apps/server/src/media/internal/strategies/primary-with-enrichment.ts`
- DB schema: `apps/server/src/db/schema/preferences/user-preferences.ts`
- Frontend architecture rules: `frontend-feature-architecture` skill
- Backend architecture rules: `backend-feature-architecture` skill
