---
goal: Persist user-submitted request "pending" state across reloads via server-derived overlay (phase 2 of issue #216)
version: 1.0
date_created: 2026-05-09
last_updated: 2026-05-09
owner: media-manager (Omid Astaraki)
status: 'Planned'
tags: [feature, bug, api, plugin-sdk, frontend]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

Implement the design at [docs/2026-05-09-request-flow-pending-persistence.md](../docs/2026-05-09-request-flow-pending-persistence.md). Today, after a successful `POST /api/requests`, request-flow components flip a local React `useState` to `"pending"` — that state evaporates on reload, so the user can re-submit the same media. This plan eliminates the local state by deriving pending status from a typed `GET /api/requests` query, adding a `DELETE /api/requests/:id` route, extending the `mediaRequest@v1.listRequests` capability output with `seasons[] / targetLabel / profileLabel`, and refactoring `MovieRequestAction` + `RequestableSeasons` to render purely from server data with optimistic React Query updates. Cancel becomes server-real for both movies and seasons.

## 1. Requirements & Constraints

- **REQ-001**: After a successful `POST /api/requests`, the pending status must persist across reload, focus, navigation, and second device — derived from `GET /api/requests`, not from component state.
- **REQ-002**: `mediaRequest@v1.listRequests` output rows gain `seasons: number[]` (required, `[]` for movies), `targetLabel: string|null`, `profileLabel: string|null`. No optional `seasons`.
- **REQ-003**: Shared package exposes `mediaRequestSchema` and `mediaRequestsResponseSchema` (`{ items: MediaRequest[] }`). `GET /api/requests` returns this typed shape.
- **REQ-004**: New `DELETE /api/requests/:requestId` route hits `MediaService.cancelRequest(requestId)` → plugin `cancelRequest`. Returns `{ ok: true }` on 2xx; errors map identically to `POST /api/requests` (404 `request.unknown_service`, 502 `request.provider_failed`).
- **REQ-005**: `MediaService.getRequests()` parses results with `z.array(mediaRequestSchema)` and propagates errors (drop the existing swallow-on-error → []).
- **REQ-006**: `MovieRequestAction` reads pending overlay from `useUserRequests()` + `selectRequestForMedia(items, tmdbId, "movie")`. Local `useState<RequestStatus>` and `useState<RequestDestination>` removed. The `useEffect([itemId, initialStatus])` reset removed.
- **REQ-007**: `RequestableSeasons` derives per-season status from `selectRequestForMedia(items, tmdbId, "tv", seasonNumber)`. Local `overrides` and `destinations` state removed. The `useEffect([itemId])` reset removed. `bulkOpen` retained as pure UI flow.
- **REQ-008**: `useCreateRequest` mutation: `onMutate` writes optimistic row keyed by `__optimistic-${crypto.randomUUID()}`; `onError` rolls back from `prev` snapshot; `onSuccess` invalidates `requestFlowKeys.history()`.
- **REQ-009**: New `useCancelRequest` mutation: `onMutate` filters cache by `id`; `onError` rolls back; `onSuccess` invalidates `requestFlowKeys.history()` only when result is non-synthetic.
- **REQ-010**: Cancel `mutationFn` short-circuits when `requestId.startsWith("__optimistic-")` and returns `{ ok: true, synthetic: true }` without hitting the network. Real branch returns `{ ok: true, synthetic: false }`.
- **REQ-011**: UI gates the cancel button when `requestId.startsWith("__optimistic-")` OR `cancel.isPending` (disabled, tooltip "submitting…").
- **REQ-012**: `MovieRequestAction` pending UI gains a × cancel button via `RequestStatusInline.onCancel` prop, symmetric with `SeasonRequestAction`.
- **REQ-013**: Status mapping helper `mediaRequestToUiStatus`: `pending|approved → "pending"`, `processing → "in-progress"`, `available → "available"`, `failed → null` (drop overlay; re-request enabled).
- **REQ-014**: `selectRequestForMedia(items, tmdbId, type, seasonNumber?)` returns the first row matching `tmdbId`+`type`+`status!=="failed"` and (when `seasonNumber` is provided) `seasons.includes(seasonNumber)`.
- **REQ-015**: Detail-page prefetch (`media-detail-page.tsx`) prefetches `requestFlowKeys.history()` alongside the existing `requestFlowKeys.targets(mediaType)` prefetch with `staleTime: 30_000`.
- **REQ-016**: Seerr `listRequests` map populates `seasons` from `r.seasons[].seasonNumber`, `targetLabel` from `r.serverName ?? null`, `profileLabel` from `r.profileName ?? null`. `SeerrRequestRow` TS type extended with `seasons?: Array<{ seasonNumber: number }>`, `serverName?: string`, `profileName?: string`.
- **REQ-017**: `requestId` is opaque to client. No client-side encoding/decoding. `mediaRequest@v1.strategy === "single"` is what guarantees list/cancel route to the same connection — no host-side routing change needed.
- **SEC-001**: `requestsApp` `requireSession` middleware already covers DELETE (applied to the sub-app, not per-route).
- **SEC-002**: `requestId` is read with `c.req.param("requestId")` — opaque string. No `zValidator("param", ...)` is added (no precedent in the procedures dir; verified across `apps/server/src/api/procedures/*.ts`). Plugin rejects malformed ids → existing error map handles 404/502.
- **CON-001**: `useUserRequests` is non-Suspense. Pending state is enrichment over wire `item.status`; loading or fetch failure must NOT block detail-page render. Falls back to wire status silently.
- **CON-002**: Synthetic cancel (`__optimistic-*` short-circuit) does NOT abort the in-flight `POST /api/requests`. Documented limitation: when create settles, its own `onSuccess` invalidates history, the row reappears, user must re-cancel with the real id. Do NOT add AbortController plumbing for this corner case.
- **CON-003**: No server-side filter of `failed` rows. Server passes them through; client `selectRequestForMedia` drops them.
- **CON-004**: No polling. Mount + window-focus refetch only.
- **CON-005**: Pre-stable repo — SDK additive change, no compat shim.
- **GUD-001**: Use Vite+ commands only — `vp check`, `vp test`, never `vitest`/`oxlint`/`pnpm` directly.
- **GUD-002**: Import test utilities from `vite-plus/test`, never `vitest`.
- **GUD-003**: Keep request-flow components flat; no `components/<x>/<thing>/` nesting (memory #17).
- **GUD-004**: Add Changesets entries per CLAUDE.md (memory #11) — one logical change per file, 1–2 sentences, past tense.
- **PAT-001**: Hooks live in `apps/client/src/features/request-flow/api/` with `query-keys.ts` factory; `requestFlowKeys.history()` already exists.
- **PAT-002**: Status-inline cancel button mirrors [season-request-action.tsx:72-83](../apps/client/src/features/request-flow/components/season-request-action.tsx#L72-L83) pattern (`<Button variant="ghost" size="xs">`, propagation stop, `aria-label`).
- **PAT-003**: Service error mapping mirrors [service.ts:255-269](../apps/server/src/media/service.ts#L255-L269) (`PluginCallError` → `mcp.target_not_found` → 404, `plugin.input_invalid|upstream_error|timeout` → 502).

## 2. Implementation Steps

### Implementation Phase 1 — Plugin SDK + Seerr listRequests output extension

- GOAL-001: Extend the `mediaRequest@v1.listRequests` schema with `seasons[]`, `targetLabel`, `profileLabel` and have the Seerr plugin populate them. Establishes the wire contract every later phase depends on.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | In [packages/plugin-sdk/src/capabilities/media-request.ts](../packages/plugin-sdk/src/capabilities/media-request.ts) (lines 56-68), extend the `listRequests` output array element schema to add `seasons: z.array(z.number().int().nonnegative())` (required, NOT optional), `targetLabel: z.string().nullable()`, `profileLabel: z.string().nullable()`. Order fields after the existing `createdAt`. | | |
| TASK-002 | In [packages/plugins/seerr/src/types.ts](../packages/plugins/seerr/src/types.ts) (lines 21-27), extend `SeerrRequestRow` with `seasons?: Array<{ seasonNumber: number }>`, `serverName?: string`, `profileName?: string`. | | |
| TASK-003 | In [packages/plugins/seerr/src/capabilities/media-request.ts](../packages/plugins/seerr/src/capabilities/media-request.ts) (around line 186 — `listRequests`), update the row map to emit `seasons: r.seasons?.map(s => s.seasonNumber) ?? []`, `targetLabel: r.serverName ?? null`, `profileLabel: r.profileName ?? null`. Preserve existing `id|tmdbId|type|title|status|createdAt` mapping. | | |
| TASK-004 | Update [packages/plugin-sdk/src/capabilities/__tests__/media-request.test.ts](../packages/plugin-sdk/src/capabilities/__tests__/media-request.test.ts) — schema snapshot tests must include the three new fields. Add a parse test that rejects rows missing `seasons` (required field). | | |
| TASK-005 | Update [packages/plugins/seerr/__tests__/media-request.test.ts](../packages/plugins/seerr/__tests__/media-request.test.ts) — extend the existing `listRequests` happy-path test with mocked Overseerr rows that include `seasons[].seasonNumber`, `serverName`, `profileName`; assert mapped output shape. Add a TV-row test where `seasons` is present and a movie-row test where `seasons` is `undefined` → output `[]`. | | |
| TASK-006 | Add a Changesets entry `.changeset/listrequests-seasons.md` with frontmatter `"@ent-mcp/plugin-sdk": minor` and `"@ent-mcp/plugin-seerr": minor`; body: "Extended request listings with season numbers and request destination labels." | | |
| TASK-007 | Run `vp check` and `vp test` from repo root; both must pass before moving on. | | |

### Implementation Phase 2 — Shared schema for typed `GET /api/requests`

- GOAL-002: Land the typed response schema for the request history list so client and server agree on shape.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-008 | In [packages/shared/src/media/schemas.ts](../packages/shared/src/media/schemas.ts), add `mediaRequestSchema = z.object({ id: z.string(), tmdbId: z.string(), type: z.enum(MEDIA_TYPES), title: z.string(), status: z.enum(["pending", "approved", "processing", "available", "failed"]), seasons: z.array(z.number().int().nonnegative()), targetLabel: z.string().nullable(), profileLabel: z.string().nullable(), createdAt: z.string() })`. Export inferred type `MediaRequest = z.infer<typeof mediaRequestSchema>`. | | |
| TASK-009 | In the same file, add `mediaRequestsResponseSchema = z.object({ items: z.array(mediaRequestSchema) })`; export inferred type `MediaRequestsResponse`. | | |
| TASK-010 | Verify [packages/shared/src/media/index.ts](../packages/shared/src/media/index.ts) re-exports `mediaRequestSchema`, `MediaRequest`, `mediaRequestsResponseSchema`, `MediaRequestsResponse`. Add if missing. | | |
| TASK-011 | Add a Changesets entry `.changeset/typed-requests-history.md`: `---\n---` (internal-only — shared package is not released). | | |
| TASK-012 | Run `vp check`. The shared change is consumed by phases 3+ — no test deltas yet. | | |

### Implementation Phase 3 — Server: typed history + cancel route + service method

- GOAL-003: Tighten `GET /api/requests` to the new typed shape and add `DELETE /api/requests/:requestId`. Wire `MediaService.cancelRequest`.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-013 | In [apps/server/src/media/service.ts](../apps/server/src/media/service.ts) (around line 339 — `getRequests`), replace the swallow-on-error try/catch body with a parsed result: `const result = await dispatchSingle<unknown[]>({ ... });` then `return z.array(mediaRequestSchema).parse(result ?? []);`. Drop the outer `try/catch` — let dispatch errors bubble. Update the return type to `Promise<MediaRequest[]>`. | | |
| TASK-014 | In [apps/server/src/media/service.ts](../apps/server/src/media/service.ts), add new method `async cancelRequest(requestId: string): Promise<void>` modeled on `requestDownload`. Call `dispatchSingle<{ ok: boolean; message?: string }>({ userId: this.userId, capability: "mediaRequest", version: "v1", method: "cancelRequest", input: { requestId } })`. Catch `PluginCallError`: `mcp.target_not_found` → `throw new HttpError(404, "request.unknown_service", "service not found")`; `plugin.input_invalid|upstream_error|timeout` → `throw new HttpError(502, "request.provider_failed", err.message)`; otherwise rethrow. After try, if `!result?.ok` → `throw new HttpError(502, "request.provider_failed", result?.message ?? "provider failed")`. | | |
| TASK-015 | In [apps/server/src/api/procedures/requests.ts](../apps/server/src/api/procedures/requests.ts), update the `GET /` handler — replace the loose passthrough with `const items = await svc.getRequests(); return c.json({ items });` (typed via the parsed shape from TASK-013). | | |
| TASK-016 | In the same file, add a new chained `.delete("/:requestId", async (c) => { const requestId = c.req.param("requestId"); const svc = new MediaService(sessionUserId(c)); await svc.cancelRequest(requestId); return c.json({ ok: true }); })`. Place after the `.post("/", ...)` handler. NO `zValidator("param", ...)` — opaque string per SEC-002. | | |
| TASK-017 | Update [apps/server/src/api/procedures/__tests__/requests.test.ts](../apps/server/src/api/procedures/__tests__/requests.test.ts): tighten the existing `GET /` test to assert the typed `MediaRequest` shape (with `seasons[]`, `targetLabel`, `profileLabel`); add new tests for `DELETE /:requestId` (happy → `{ ok: true }`, `mcp.target_not_found` → 404 `request.unknown_service`, `plugin.input_invalid` → 502 `request.provider_failed`); add a test that `GET /` passes `failed`-status rows through unchanged (no server-side filter). | | |
| TASK-018 | Update [apps/server/src/media/__tests__/service.request-flow.test.ts](../apps/server/src/media/__tests__/service.request-flow.test.ts): add `cancelRequest` happy + the same three error map cases as `requestDownload`. Add a `getRequests` test for the schema parse path (success and parse-fail throws). | | |
| TASK-019 | Run `vp check` and `vp test apps/server`. Both must pass. | | |

### Implementation Phase 4 — Client API client + hooks + helpers

- GOAL-004: Add `requestsApi.history`, `requestsApi.cancel`, `useUserRequests`, `useCancelRequest`. Extend `useCreateRequest` with optimistic update. Add helpers.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-020 | In [apps/client/src/features/request-flow/api/client.ts](../apps/client/src/features/request-flow/api/client.ts), add `async history(): Promise<MediaRequestsResponse>` calling `api.requests.$get()` and parsing with `mediaRequestsResponseSchema.parse(await res.json())`. Throw via `throwOnError(res)` on `!res.ok`. | | |
| TASK-021 | In the same file, add `async cancel(requestId: string): Promise<{ ok: true }>` calling `api.requests[":requestId"].$delete({ param: { requestId } })`. Throw via `throwOnError(res)` on `!res.ok`. | | |
| TASK-022 | In [apps/client/src/features/request-flow/lib/request-helpers.ts](../apps/client/src/features/request-flow/lib/request-helpers.ts), add `mediaRequestToUiStatus(s: MediaRequest["status"]): RequestStatus | null` returning `"pending"` for `pending|approved`, `"in-progress"` for `processing`, `"available"` for `available`, `null` for `failed`. | | |
| TASK-023 | In the same file, add `selectRequestForMedia(items: MediaRequest[] | undefined, tmdbId: string, type: "movie" \| "tv", seasonNumber?: number): MediaRequest | undefined` per design §C.3. | | |
| TASK-024 | Create new file `apps/client/src/features/request-flow/api/use-user-requests.ts`: `useUserRequests()` returns `useQuery({ queryKey: requestFlowKeys.history(), queryFn: () => requestsApi.history(), staleTime: 30_000, refetchOnWindowFocus: true })`. NOT `useSuspenseQuery`. | | |
| TASK-025 | Create new file `apps/client/src/features/request-flow/api/use-cancel-request.ts`: `useCancelRequest()` returns `useMutation` per design §C.7 — `mutationFn` short-circuits when `requestId.startsWith("__optimistic-")` returning `{ ok: true, synthetic: true }`; real branch returns `{ ...await requestsApi.cancel(requestId), synthetic: false }`. `onMutate` cancels queries, snapshots `prev`, filters cache by id. `onError` restores `prev` and calls `toastFromError`. `onSuccess(data)` skips invalidate when `data?.synthetic === true`; otherwise `qc.invalidateQueries({ queryKey: requestFlowKeys.history() })`. | | |
| TASK-026 | Modify [apps/client/src/features/request-flow/api/use-create-request.ts](../apps/client/src/features/request-flow/api/use-create-request.ts): add `onMutate` that cancels `requestFlowKeys.history()` queries, snapshots `prev`, appends optimistic row `{ id: `__optimistic-${crypto.randomUUID()}`, tmdbId, type: mediaType, title: "", status: "pending", seasons: seasons ?? [], targetLabel: null, profileLabel: null, createdAt: new Date().toISOString() }`. Add `onError` to roll back from `prev` and surface existing toast. Add `onSuccess` that invalidates `requestFlowKeys.history()` (only). DO NOT invalidate `targets()`. | | |
| TASK-027 | Update [apps/client/src/features/request-flow/api/index.ts](../apps/client/src/features/request-flow/api/index.ts) and [apps/client/src/features/request-flow/index.ts](../apps/client/src/features/request-flow/index.ts) to re-export `useUserRequests` and `useCancelRequest`. | | |
| TASK-028 | Run `vp check`. Build must succeed; component edits land in Phase 5. | | |

### Implementation Phase 5 — Component refactor: derive, don't store

- GOAL-005: Replace local `useState` overlays in `MovieRequestAction` and `RequestableSeasons` with derived render from `useUserRequests`. Add cancel UI to movie pending state.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-029 | In [apps/client/src/features/request-flow/components/request-status-inline.tsx](../apps/client/src/features/request-flow/components/request-status-inline.tsx), add optional prop `onCancel?: () => void` and optional `cancelDisabled?: boolean`. When `onCancel` is provided, render an `<Button variant="ghost" size="xs">` with × icon and `aria-label={m.request_pending_cancel_tooltip()}` after the label `<span>`, mirroring [season-request-action.tsx:72-83](../apps/client/src/features/request-flow/components/season-request-action.tsx#L72-L83). Click handler must call `event.stopPropagation()` then `onCancel()`. The tooltip must wrap the label only — not the button — so the affordance stays visible. When `cancelDisabled` is true, disable the button and swap its tooltip to "submitting…" (new message key `request_pending_cancel_submitting`). | | |
| TASK-030 | In [apps/client/src/features/request-flow/components/movie-request-action.tsx](../apps/client/src/features/request-flow/components/movie-request-action.tsx), remove `useState<RequestStatus>`, `useState<RequestDestination>`, the `useEffect([itemId, initialStatus])` reset, and the `setStatus("pending")` + `setDestination(...)` + `setOpen(false)` calls inside `handleSubmit`. Replace with: `const { data } = useUserRequests();`, `const tmdbId = tmdbIdFromItemId(itemId);`, `const userRow = selectRequestForMedia(data?.items, tmdbId, "movie");`, `const userStatus = userRow ? mediaRequestToUiStatus(userRow.status) : null;`, `const status = userStatus ?? normalizeRequestStatus(initialStatus);`, `const destination = userRow ? { serviceLabel: userRow.targetLabel ?? "—", profileLabel: userRow.profileLabel } : NEUTRAL_DESTINATION;`. The early return at line 66 still triggers — popover unmounts on optimistic flip (intended). | | |
| TASK-031 | In the same file, wire cancel: `const cancel = useCancelRequest();` and pass `onCancel={() => userRow && cancel.mutate({ requestId: userRow.id })}` plus `cancelDisabled={cancel.isPending || (userRow?.id?.startsWith("__optimistic-") ?? false)}` to `<RequestStatusInline>`. | | |
| TASK-032 | In [apps/client/src/features/request-flow/components/requestable-seasons.tsx](../apps/client/src/features/request-flow/components/requestable-seasons.tsx), remove `useState<Record<number, RequestStatus>> overrides`, `useState<Record<number, RequestDestination>> destinations`, the `useEffect([itemId])` reset, the `applyOverrides` function, and the calls to `applyOverrides` in `submit`. KEEP `bulkOpen` state and its `setBulkOpen(false)` after bulk submit. Replace `resolvedSeasons` `useMemo` with the design §C.5 derived map that includes `requestId: row?.id ?? null`. | | |
| TASK-033 | In the same file, change `handleSeasonCancel(seasonNumber)` → `handleSeasonCancel(requestId: string)` and have it call `cancel.mutateAsync({ requestId })`. Update each `SeasonRow.onCancelPending` prop pass-through to forward `entry.requestId!` (non-null at call site by construction — see design §C.5). Pass `entry.requestId` and a derived `cancelDisabled` flag through to `SeasonRequestAction`. | | |
| TASK-034 | In [apps/client/src/features/request-flow/components/season-request-action.tsx](../apps/client/src/features/request-flow/components/season-request-action.tsx) (lines 72-83), add `cancelDisabled?: boolean` prop and disable the cancel `<Button>` when `cancelDisabled` is true; tooltip text becomes `request_pending_cancel_submitting`. | | |
| TASK-035 | In paraglide messages, add `request_pending_cancel_submitting` (English: "Submitting…"). Run paraglide compile if required by the build. | | |
| TASK-036 | In [apps/client/src/features/media-detail/components/media-detail-page.tsx](../apps/client/src/features/media-detail/components/media-detail-page.tsx) (around lines 84-91), within the existing prefetch `useEffect`, add a second `queryClient.prefetchQuery({ queryKey: requestFlowKeys.history(), queryFn: () => requestsApi.history(), staleTime: 30_000 })` call. Keep the existing targets prefetch unchanged. | | |
| TASK-037 | Run `vp check` and `vp test apps/client`. Compilation and existing tests must pass; failing tests are Phase 6's job. | | |

### Implementation Phase 6 — Tests + changesets + final verification

- GOAL-006: Adapt existing tests, add new regression coverage for persistence and cancel flows, and write the per-package changesets.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-038 | Update [apps/client/src/features/request-flow/__tests__/movie-request-action.test.tsx](../apps/client/src/features/request-flow/__tests__/movie-request-action.test.tsx): replace tests that asserted `setStatus("pending")` after submit. New assertions: (a) optimistic cache write transitions UI to `<RequestStatusInline status="pending">` synchronously after submit click, (b) on submit error, no cache row remains and the trigger button re-renders, (c) `useUserRequests` mocked to return a matching tmdbId row → component renders pending without any user submit (regression for the persistence bug). | | |
| TASK-039 | Update [apps/client/src/features/request-flow/__tests__/requestable-seasons.test.tsx](../apps/client/src/features/request-flow/__tests__/requestable-seasons.test.tsx): replace tests that asserted local `overrides` state. New assertions: (a) per-season pending derived from `useUserRequests` mock — only the matching `seasons.includes(N)` row marks season N as pending, others infer from `season.counts`, (b) bulk-submit optimistic adds one cache row with all season numbers, (c) failure rolls back; no override remains. | | |
| TASK-040 | Add new test [apps/client/src/features/request-flow/__tests__/pending-persistence.test.tsx](../apps/client/src/features/request-flow/__tests__/pending-persistence.test.tsx): mount `MovieRequestAction` and `RequestableSeasons` with a query client whose `useUserRequests` returns matching rows; assert pending UI renders WITHOUT any user interaction (simulates reload-after-submit). | | |
| TASK-041 | Add new test [apps/client/src/features/request-flow/__tests__/failed-row-allows-retry.test.tsx](../apps/client/src/features/request-flow/__tests__/failed-row-allows-retry.test.tsx): mock `useUserRequests` returning a `status: "failed"` row matching the tmdbId; assert the request button still renders (overlay dropped). | | |
| TASK-042 | Add new test [apps/client/src/features/request-flow/__tests__/cancel-flow.test.tsx](../apps/client/src/features/request-flow/__tests__/cancel-flow.test.tsx): mock `useUserRequests` with a real (non-optimistic) row; click cancel → asserts (a) `requestsApi.cancel` called with the row id, (b) optimistic cache filter applied, (c) `invalidateQueries` called on success, (d) on server error, cache rolls back and the cancel button re-renders. | | |
| TASK-043 | Add new test [apps/client/src/features/request-flow/__tests__/cancel-during-optimistic.test.tsx](../apps/client/src/features/request-flow/__tests__/cancel-during-optimistic.test.tsx): submit a request and immediately cancel before mutation resolves (use `vi.fn()` controlled promises). Assert: `requestsApi.cancel` was NOT called, the local cache filter still removed the optimistic row, and no `invalidateQueries` fired (synthetic branch). | | |
| TASK-044 | Add Changesets entries: `.changeset/persist-pending-server.md` with frontmatter `"@ent-mcp/client": minor`, `"@ent-mcp/server": minor` and body "Pending request status now survives reloads and supports server-side cancellation." Verify Phase 1 and Phase 2 changesets are still present and consistent. | | |
| TASK-045 | Run `vp check` and `vp test` from repo root. Both must pass cleanly. Run `vp lint` to confirm no oxlint regressions. | | |
| TASK-046 | Manual smoke test in `vp dev`: (a) submit movie request, hard reload, confirm pending persists; (b) submit season 3 request, hard reload, confirm only season 3 is pending; (c) cancel a pending request, confirm it disappears and POST is sent; (d) submit and immediately cancel before the server responds — confirm no 404 toast appears. | | |

## 3. Alternatives

- **ALT-001**: Persist pending state in `localStorage` keyed by tmdbId. Rejected — stale forever if request is approved/declined out-of-band, lies on a different device, never self-heals.
- **ALT-002**: Hybrid (server-derived + short-TTL localStorage cache). Rejected — adds complexity without measurable win once optimistic+invalidate works; the only thing it buys is cross-tab sync, which is not in scope.
- **ALT-003**: Add a new `getMediaRequest(tmdbId, type)` plugin method instead of extending `listRequests` output. Rejected — heavier per-detail roundtrip and a brand-new method when an additive field on the existing method suffices.
- **ALT-004**: Filter `failed` rows server-side. Rejected — keeps server stateless and easier to test; client decides UI policy.
- **ALT-005**: Show a generic "Requested" tooltip on persisted pending rows (no labels). Rejected — inconsistent UX between just-submitted and reloaded; trivial to populate via `targetLabel`/`profileLabel` from Overseerr.
- **ALT-006**: Drop the cancel button on movie pending UI. Rejected — once cancel is server-real, asymmetry with seasons is unjustifiable.
- **ALT-007**: AbortController plumbing on `useCreateRequest` so synthetic cancel actually kills the in-flight POST. Rejected — corner-case-only complexity; UI gate + short-circuit guard is sufficient.
- **ALT-008**: Add polling so pending → in-progress transitions show without focus. Rejected — explicit non-goal in the design; focus refetch covers it.

## 4. Dependencies

- **DEP-001**: `@tanstack/react-query` (catalog) — already a workspace dep; uses `useMutation` `onMutate`/`onError`/`onSuccess` API. No version bump.
- **DEP-002**: `zod` (catalog) — already a workspace dep; `nullable()` and `array(int())` patterns already used in the codebase.
- **DEP-003**: `crypto.randomUUID()` — Web Platform API; available in all modern browsers; already used elsewhere in the client (verify with grep before relying).
- **DEP-004**: `@hono/zod-validator` (already used) — NOT extended for path params; intentional per SEC-002.
- **DEP-005**: Phase 1 of the request flow (commits `0c2e024`, `85ecfa5`, `6d0bb2d`) — all infrastructure (`requestsApp`, `dispatchSingle`, `requireSession`, `RequestError`, `requestFlowKeys`) already in place.

## 5. Files

- **FILE-001**: [packages/plugin-sdk/src/capabilities/media-request.ts](../packages/plugin-sdk/src/capabilities/media-request.ts) — `listRequests` output schema extended.
- **FILE-002**: [packages/plugin-sdk/src/capabilities/__tests__/media-request.test.ts](../packages/plugin-sdk/src/capabilities/__tests__/media-request.test.ts) — schema snapshot updated.
- **FILE-003**: [packages/plugins/seerr/src/types.ts](../packages/plugins/seerr/src/types.ts) — `SeerrRequestRow` extended with `seasons?`, `serverName?`, `profileName?`.
- **FILE-004**: [packages/plugins/seerr/src/capabilities/media-request.ts](../packages/plugins/seerr/src/capabilities/media-request.ts) — `listRequests` mapper populates new fields.
- **FILE-005**: [packages/plugins/seerr/__tests__/media-request.test.ts](../packages/plugins/seerr/__tests__/media-request.test.ts) — listRequests test extended.
- **FILE-006**: [packages/shared/src/media/schemas.ts](../packages/shared/src/media/schemas.ts) — `mediaRequestSchema`, `mediaRequestsResponseSchema` added.
- **FILE-007**: [packages/shared/src/media/index.ts](../packages/shared/src/media/index.ts) — re-exports.
- **FILE-008**: [apps/server/src/media/service.ts](../apps/server/src/media/service.ts) — `getRequests` typed; `cancelRequest` added.
- **FILE-009**: [apps/server/src/api/procedures/requests.ts](../apps/server/src/api/procedures/requests.ts) — `GET /` typed; `DELETE /:requestId` added.
- **FILE-010**: [apps/server/src/api/procedures/__tests__/requests.test.ts](../apps/server/src/api/procedures/__tests__/requests.test.ts) — DELETE coverage; typed-shape assertions.
- **FILE-011**: [apps/server/src/media/__tests__/service.request-flow.test.ts](../apps/server/src/media/__tests__/service.request-flow.test.ts) — `cancelRequest` + parsed `getRequests` coverage.
- **FILE-012**: [apps/client/src/features/request-flow/api/client.ts](../apps/client/src/features/request-flow/api/client.ts) — `history()` and `cancel()` added.
- **FILE-013**: [apps/client/src/features/request-flow/lib/request-helpers.ts](../apps/client/src/features/request-flow/lib/request-helpers.ts) — `mediaRequestToUiStatus` + `selectRequestForMedia` added.
- **FILE-014**: `apps/client/src/features/request-flow/api/use-user-requests.ts` — NEW.
- **FILE-015**: `apps/client/src/features/request-flow/api/use-cancel-request.ts` — NEW.
- **FILE-016**: [apps/client/src/features/request-flow/api/use-create-request.ts](../apps/client/src/features/request-flow/api/use-create-request.ts) — `onMutate`/`onError`/`onSuccess` extended.
- **FILE-017**: [apps/client/src/features/request-flow/api/index.ts](../apps/client/src/features/request-flow/api/index.ts) — re-exports.
- **FILE-018**: [apps/client/src/features/request-flow/index.ts](../apps/client/src/features/request-flow/index.ts) — re-exports.
- **FILE-019**: [apps/client/src/features/request-flow/components/request-status-inline.tsx](../apps/client/src/features/request-flow/components/request-status-inline.tsx) — `onCancel`, `cancelDisabled` props.
- **FILE-020**: [apps/client/src/features/request-flow/components/movie-request-action.tsx](../apps/client/src/features/request-flow/components/movie-request-action.tsx) — derive-from-server refactor; cancel wiring.
- **FILE-021**: [apps/client/src/features/request-flow/components/requestable-seasons.tsx](../apps/client/src/features/request-flow/components/requestable-seasons.tsx) — derive-from-server refactor; `bulkOpen` retained.
- **FILE-022**: [apps/client/src/features/request-flow/components/season-request-action.tsx](../apps/client/src/features/request-flow/components/season-request-action.tsx) — `cancelDisabled` prop; uses `requestId` from props.
- **FILE-023**: [apps/client/src/features/media-detail/components/media-detail-page.tsx](../apps/client/src/features/media-detail/components/media-detail-page.tsx) — history prefetch added.
- **FILE-024**: `apps/client/messages/en.json` (or paraglide source) — `request_pending_cancel_submitting` key added.
- **FILE-025**: `apps/client/src/features/request-flow/__tests__/movie-request-action.test.tsx` — updated.
- **FILE-026**: `apps/client/src/features/request-flow/__tests__/requestable-seasons.test.tsx` — updated.
- **FILE-027**: `apps/client/src/features/request-flow/__tests__/pending-persistence.test.tsx` — NEW.
- **FILE-028**: `apps/client/src/features/request-flow/__tests__/failed-row-allows-retry.test.tsx` — NEW.
- **FILE-029**: `apps/client/src/features/request-flow/__tests__/cancel-flow.test.tsx` — NEW.
- **FILE-030**: `apps/client/src/features/request-flow/__tests__/cancel-during-optimistic.test.tsx` — NEW.
- **FILE-031**: `.changeset/listrequests-seasons.md` — NEW (plugin-sdk + plugin-seerr minor).
- **FILE-032**: `.changeset/typed-requests-history.md` — NEW (internal-only).
- **FILE-033**: `.changeset/persist-pending-server.md` — NEW (client + server minor).

## 6. Testing

- **TEST-001**: SDK schema test asserts `listRequests` output requires `seasons`, accepts `null` for `targetLabel`/`profileLabel`. Failing parse on missing `seasons` is the regression guard.
- **TEST-002**: Seerr plugin test: TV row maps `r.seasons[].seasonNumber` → `seasons[]`; movie row with `r.seasons === undefined` → `seasons: []`; `serverName`/`profileName` map to `targetLabel`/`profileLabel`.
- **TEST-003**: Server `GET /api/requests` returns the typed shape verbatim including `failed`-status rows (no server-side filter).
- **TEST-004**: Server `DELETE /api/requests/:id` happy-path → `{ ok: true }`. Plugin `mcp.target_not_found` → 404 `request.unknown_service`. Plugin `plugin.input_invalid` → 502 `request.provider_failed`.
- **TEST-005**: `MediaService.getRequests` parse failure throws (no swallow).
- **TEST-006**: `MediaService.cancelRequest` error map mirrors `requestDownload`.
- **TEST-007**: `MovieRequestAction` renders pending UI when `useUserRequests` returns a matching tmdbId row, WITHOUT any user submit (regression for the bug being fixed).
- **TEST-008**: `RequestableSeasons` per-season pending derived from `seasons.includes(N)` filter — only the matching season marked pending; mismatched ones derived from `inferSeasonStatus`.
- **TEST-009**: Submit happy path: `onMutate` writes optimistic row → UI flips to pending immediately → on 2xx, `invalidateQueries` runs → server state replaces optimistic row.
- **TEST-010**: Submit failure path: `onError` rolls back; the request button reappears; existing toast assertion preserved.
- **TEST-011**: Cancel happy path: `requestsApi.cancel(realId)` called with the real id; optimistic cache filter removes the row; `invalidateQueries` fires on success.
- **TEST-012**: Cancel during optimistic window: synthetic short-circuit fires; `requestsApi.cancel` NOT called; cache filter still removes the optimistic row; `invalidateQueries` NOT called (synthetic branch).
- **TEST-013**: Failed row → re-request enabled (button renders, no overlay).

## 7. Risks & Assumptions

- **RISK-001**: Overseerr instances on older versions may not include `serverName`/`profileName` in the `/request` payload. Mitigation: schema treats both as nullable; UI falls back to `"—"` for label and a neutral profile chip. No 5xx path.
- **RISK-002**: Overseerr instances may omit `seasons` for movie rows or pre-existing TV rows. Mitigation: plugin maps `?? []`; required-`[]` shape on the wire absorbs the absence.
- **RISK-003**: Synthetic cancel + create both completing in fast succession may produce a brief flash where the just-cancelled row reappears (the `useCreateRequest.onSuccess` invalidate brings it back from server). Mitigation: documented as accepted limitation in design §C.7. UI gate (disable cancel while optimistic) makes this practically unreachable.
- **RISK-004**: Status mapping `approved → "pending"` may surprise users who expect "approved" to feel different from "pending". Mitigation: mirrors current UX where approved-but-not-yet-downloading appears the same as pending; can revisit when status-detail UI lands as a follow-up.
- **RISK-005**: Removing `getRequests` swallow-on-error means a transient plugin error blanks the history — and therefore disables persistence — until next refetch. Mitigation: `useUserRequests` is non-Suspense and falls back to wire `item.status`. Wire status keeps showing "available"/"requested" via `getStatusBatch`. UI never breaks.
- **RISK-006**: `__optimistic-` id prefix is treated as untrusted input on the server; a malicious client could call `DELETE /api/requests/__optimistic-…`. Mitigation: plugin already returns `mcp.target_not_found` → 404 for any unknown id. No new server-side check needed.
- **ASSUMPTION-001**: `mediaRequest@v1.strategy === "single"` will continue to deterministically pick the same connection across `listRequests` and `cancelRequest` for a given user. (Verified — `dispatchSingle` is priority-based and stable.)
- **ASSUMPTION-002**: `crypto.randomUUID()` is available in all browsers the project targets. (Verify with `grep -r "crypto.randomUUID" apps/client/src` before relying; if absent, fall back to a counter.)
- **ASSUMPTION-003**: Existing `requestFlowKeys.history()` query key is unused today (no consumer of `GET /api/requests`). Verified in design phase.
- **ASSUMPTION-004**: Phase 1 (issue #216) is fully shipped; this plan does NOT modify any code that has not already landed.

## 8. Related Specifications / Further Reading

- [docs/2026-05-09-request-flow-pending-persistence.md](../docs/2026-05-09-request-flow-pending-persistence.md) — design (this plan's source of truth).
- [docs/2026-05-08-request-flow-api-wiring.md](../docs/2026-05-08-request-flow-api-wiring.md) — phase 1 design (shipped).
- [plan/feature-request-flow-api-1.md](./feature-request-flow-api-1.md) — phase 1 implementation plan (shipped).
- Issue [#216](https://github.com/electather/media-manager/issues/216).
- TanStack Query optimistic updates: <https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates>.
