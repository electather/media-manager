# Request flow — pending persistence

**Status:** design. Phase 2 of [2026-05-08-request-flow-api-wiring.md](./2026-05-08-request-flow-api-wiring.md). Continues issue [#216](https://github.com/electather/media-manager/issues/216) follow-ups.

Caveman ultra. Pseudocode = source-of-truth shape, not literal.

## Problem

`setStatus("pending")` after 2xx → memory only. Reload → component remount → seed from `item.status` (wire data, no user-pending knowledge) → button re-armed → user re-submits.

## Goal

User-submitted pending survive reload + focus + nav + cross-device. No double-submit. Cancel real (server), not memory.

## Non-goals

Polling. Push notif. History page UI. Multi-target fan-out. Root/tag/lang pickers.

## Approach

Server = single source of truth. Client overlay derived from `GET /api/requests`. RQ cache + invalidate. Cancel via new `DELETE /api/requests/:id`.

---

## §S Server

### S.1 SDK — `mediaRequest@v1.listRequests` output ⊕ fields

→ [packages/plugin-sdk/src/capabilities/media-request.ts](../packages/plugin-sdk/src/capabilities/media-request.ts)

```ts
listRequests.output = z.array(z.object({
  id, tmdbId, type, title, status,                                       // existing
  createdAt,                                                             // existing
  seasons:      z.array(z.number().int().nonnegative()).optional().default([]),  // NEW · [] for movies / unrouted requests
  targetLabel:  z.string().nullable().optional().default(null),          // NEW · e.g. "Radarr Main"
  profileLabel: z.string().nullable().optional().default(null),          // NEW · e.g. "1080p"
}))
```

Pre-stable. Additive. No compat shim. Each new field is `.optional().default(...)` so a plugin that omits the key still parses; the Seerr mapper writes the same defaults explicitly (§S.2) and the SDK-level default is a defence-in-depth for third-party plugins (issue #427).

### S.2 Seerr plugin — listRequests map

→ [packages/plugins/seerr/src/capabilities/media-request.ts:186](../packages/plugins/seerr/src/capabilities/media-request.ts#L186)

**Pre-req — extend `SeerrRequestRow`** → [packages/plugins/seerr/src/types.ts:21](../packages/plugins/seerr/src/types.ts#L21)

```ts
SeerrRequestRow = {
  id, type, status, createdAt, media,                        // existing
  seasons?:    Array<{ seasonNumber: number }>,              // NEW
  serverName?: string,                                        // NEW
  profileName?: string,                                       // NEW
}
```

Overseerr `/request` rows already include these — just unmodeled in current TS type.

**Map:**

```
fetchAllRequests(c) → rows
return rows.map(r => ({
  id, tmdbId, type, title, status, createdAt,        // existing
  seasons:      r.seasons?.map(s => s.seasonNumber) ?? [],
  targetLabel:  r.serverName  ?? null,
  profileLabel: r.profileName ?? null,
}))
```

### S.3 Shared schema — typed `GET /api/requests`

→ [packages/shared/src/media/schemas.ts](../packages/shared/src/media/schemas.ts)

```ts
mediaRequestSchema = {
  id, tmdbId, type, title,
  status: enum(pending|approved|processing|available|failed),
  seasons: int[]≥0,
  targetLabel:  string|null,
  profileLabel: string|null,
  createdAt: string,
}
mediaRequestsResponseSchema = { items: MediaRequest[] }
```

### S.4 Server routes

→ [apps/server/src/api/procedures/requests.ts](../apps/server/src/api/procedures/requests.ts)

```
requestsApp = Hono.use("*", requireSession)
  .GET("/")                              → svc.getRequests() → {items}      // tighten shape
  .GET("/targets", zVal(query))          → svc.listRequestTargets(...)      // unchanged
  .POST("/", zVal(json))                 → svc.requestDownload(body)        // unchanged
  .DELETE("/:requestId", ...)            → svc.cancelRequest(c.req.param("requestId")) → {ok:true}   // NEW
```

`requestId` opaque to client. Plugin owns namespace. `mediaRequest@v1.strategy=single` → cancel routes to same conn that emitted row. Consistent.

**Path-param validation:** No `zValidator("param", ...)` precedent in this app — all existing usages are `"query"`/`"json"` (verified across [apps/server/src/api/procedures/](../apps/server/src/api/procedures/)). Take `requestId` as opaque string via `c.req.param("requestId")`; plugin rejects malformed ids → maps to 502/404 per existing error map. No new validator surface.

### S.5 MediaService

→ [apps/server/src/media/service.ts](../apps/server/src/media/service.ts)

**Tighten `getRequests()`** (was swallow-on-error → []):

```
async getRequests(): Promise<MediaRequest[]>
  result = await dispatchSingle<unknown>({ ...listRequests })
  return z.array(mediaRequestSchema).parse(result ?? [])
  // throw on dispatch err → RQ surfaces error state
```

No server-side filter of `failed` rows. Pass-through. Client decides.

**New `cancelRequest(requestId)`:**

```
async cancelRequest(requestId)
  try:
    result = await dispatchSingle<{ok,message?}>({
      userId, capability:mediaRequest, version:v1,
      method:cancelRequest, input:{ requestId }
    })
  catch PluginCallError e:
    "mcp.target_not_found"                                    → 404 request.unknown_service
    "plugin.input_invalid" | "upstream_error" | "timeout"     → 502 request.provider_failed
    else                                                      → rethrow (→ 500)
  if !result?.ok: throw 502 request.provider_failed (result?.message)
```

---

## §C Client

### C.1 New query hook — `useUserRequests`

→ `apps/client/src/features/request-flow/api/use-user-requests.ts` (NEW)

```ts
useUserRequests() = useQuery({
  queryKey: requestFlowKeys.history(),
  queryFn:  () => requestsApi.history(),
  staleTime: 30_000,
  refetchOnWindowFocus: true,
})
```

**Non-Suspense by design.** Pending = enrichment over wire `item.status`. Fetch fail / load → fall back to wire status. Never block render.

### C.2 API client ⊕

→ [apps/client/src/features/request-flow/api/client.ts](../apps/client/src/features/request-flow/api/client.ts)

```ts
async history(): Promise<MediaRequestsResponse>
  res = api.requests.$get()
  if !res.ok: throwOnError(res)
  return mediaRequestsResponseSchema.parse(await res.json())

async cancel(requestId): Promise<{ok:true}>
  res = api.requests[":requestId"].$delete({ param:{requestId} })
  if !res.ok: throwOnError(res)
  return { ok:true }
```

### C.3 Helpers — status map + selector

→ [apps/client/src/features/request-flow/lib/request-helpers.ts](../apps/client/src/features/request-flow/lib/request-helpers.ts)

```ts
mediaRequestToUiStatus(s) =
  s=="pending"    → "pending"
  s=="approved"   → "pending"          // approved-but-not-downloading
  s=="processing" → "in-progress"
  s=="available"  → "available"
  s=="failed"     → null                // drop · re-request enabled

selectRequestForMedia(items, tmdbId, type, seasonNumber?) =
  items?.find(r =>
    r.tmdbId===tmdbId && r.type===type && r.status!="failed" &&
    (seasonNumber===undef || r.seasons.includes(seasonNumber)))
```

### C.4 `MovieRequestAction` — derive, don't store

→ [apps/client/src/features/request-flow/components/movie-request-action.tsx](../apps/client/src/features/request-flow/components/movie-request-action.tsx)

```ts
const { data } = useUserRequests()
const tmdbId   = tmdbIdFromItemId(itemId)
const userRow  = selectRequestForMedia(data?.items, tmdbId, "movie")
const userSt   = userRow ? mediaRequestToUiStatus(userRow.status) : null
const status   = userSt ?? normalizeRequestStatus(initialStatus)
const dest     = userRow
  ? { serviceLabel: userRow.targetLabel ?? "—", profileLabel: userRow.profileLabel }
  : NEUTRAL
```

**Drop:** `useState<RequestStatus>`, `useState<RequestDestination>`, `useEffect([itemId, initialStatus])` reset, `setStatus("pending")` post-submit, `setDestination(...)` post-submit. Invalidate via mutation.

**Add cancel:** `RequestStatusInline` today is a non-interactive tooltip-wrapped `<span>` (no button slot). Extension required:
- ⊕ optional `onCancel?: () => void` prop.
- When provided, render compact `<Button variant="ghost" size="xs">` w/ × icon trailing the label (mirror season-request-action.tsx:72-83 pattern).
- A11y: `aria-label={m.request_pending_cancel_tooltip()}` (existing message); button stops propagation; focus ring scoped via `cn(...)`.
- Tooltip wraps the label `<span>` only, not the cancel button (keeps tooltip from hiding the affordance).
- Disable + tooltip "submitting…" while `cancel.isPending` OR `requestId.startsWith("__optimistic-")` (see C.7 race below).

**Mid-flow popover unmount on optimistic flip — intended.** Submit handler currently keeps `<Popover open>` while `mutateAsync` settles, then `setOpen(false)` + `setStatus("pending")`. With derived status + optimistic cache: cache write fires inside `onMutate` → status flips to `pending` → early-return at [movie-request-action.tsx:66](../apps/client/src/features/request-flow/components/movie-request-action.tsx#L66) swaps `<Popover>` subtree for `<RequestStatusInline>` instantly. Goal of the design (instant pending). Drop `setOpen(false)` from submit handler — re-derived render handles unmount. Document in §E.

### C.5 `RequestableSeasons` — derive, don't store

→ [apps/client/src/features/request-flow/components/requestable-seasons.tsx](../apps/client/src/features/request-flow/components/requestable-seasons.tsx)

```ts
const { data } = useUserRequests()
const tmdbId   = tmdbIdFromItemId(itemId)

resolvedSeasons = useMemo(() =>
  seasons.map(season => {
    const row    = selectRequestForMedia(data?.items, tmdbId, "tv", season.number)
    const userSt = row ? mediaRequestToUiStatus(row.status) : null
    return {
      season,
      status:      userSt ?? inferSeasonStatus(season),
      destination: row
        ? { serviceLabel: row.targetLabel ?? "—", profileLabel: row.profileLabel }
        : NEUTRAL_DESTINATION,
      requestId:   row?.id ?? null,
    }
  }),
  [seasons, data, tmdbId])
```

**Drop:** `overrides` state, `destinations` state, `useEffect([itemId])` reset, `applyOverrides(...)`, `handleSeasonCancel`'s state mutation.

`handleSeasonCancel(requestId)` → `cancel.mutateAsync({ requestId })`. No local mutation; cache update via mutation.

**`requestId` non-null at call site:** Cancel button only renders when season-row `status === "pending"`. Status only resolves to `"pending"` when `userSt = mediaRequestToUiStatus(row.status) !== null`, which requires `row` to exist, which means `requestId = row.id` (real or `__optimistic-…`, never `null`). Wire `onCancelPending={() => handleSeasonCancel(requestId!)}` — non-null assertion safe by construction.

**`bulkOpen` local UI state retained.** Bulk-request popover (`setBulkOpen(false)` after submit) stays — it's pure UI flow, not request status. Only `overrides`/`destinations` are removed. `requestable-seasons.tsx:137` `setBulkOpen(false)` call kept.

### C.6 `useCreateRequest` — optimistic

→ [apps/client/src/features/request-flow/api/use-create-request.ts](../apps/client/src/features/request-flow/api/use-create-request.ts)

```ts
useMutation({
  mutationFn: requestsApi.create,
  onMutate: async (vars) => {
    await qc.cancelQueries({ queryKey: requestFlowKeys.history() })
    const prev = qc.getQueryData(requestFlowKeys.history())
    qc.setQueryData(requestFlowKeys.history(), (old) => ({
      items: [...(old?.items ?? []), {
        id: `__optimistic-${crypto.randomUUID()}`,
        tmdbId: vars.tmdbId, type: vars.mediaType, title: "",
        status: "pending" as const,
        seasons: vars.seasons ?? [],
        targetLabel: null, profileLabel: null,
        createdAt: new Date().toISOString(),
      }],
    }))
    return { prev }
  },
  onError: (_e, _v, ctx) => {
    if (ctx?.prev) qc.setQueryData(requestFlowKeys.history(), ctx.prev)
    toastFromError(...)
  },
  onSuccess: () => qc.invalidateQueries({ queryKey: requestFlowKeys.history() }),
})
```

Instant pending UI. Rollback on err → no flicker. Invalidate on 2xx → real `id` + `targetLabel`/`profileLabel` hydrate.

Distinct from `targets` cache. Existing rule "NO invalidate(targets)" unchanged. We invalidate `history()` only.

### C.7 New `useCancelRequest`

→ `apps/client/src/features/request-flow/api/use-cancel-request.ts` (NEW)

```ts
// mutationFn return: { ok: true; synthetic: boolean }
useCancelRequest() = useMutation({
  mutationFn: async ({ requestId }) => {
    // Short-circuit: row still has optimistic id (createRequest hasn't settled).
    // Fire-and-forget local removal — never hit server with synthetic id.
    if (requestId.startsWith("__optimistic-")) return { ok: true as const, synthetic: true }
    return { ...await requestsApi.cancel(requestId), synthetic: false }
  },
  onMutate: async ({ requestId }) => {
    await qc.cancelQueries({ queryKey: requestFlowKeys.history() })
    const prev = qc.getQueryData(requestFlowKeys.history())
    qc.setQueryData(requestFlowKeys.history(), (old) => ({
      items: (old?.items ?? []).filter(r => r.id !== requestId),
    }))
    return { prev }
  },
  onError: (_e, _v, ctx) => {
    if (ctx?.prev) qc.setQueryData(requestFlowKeys.history(), ctx.prev)
    toastFromError(...)
  },
  onSuccess: (data) => {
    // Skip invalidate when synthetic — invalidate would refetch and re-introduce
    // the just-cancelled row if the in-flight create has already 201'd. The real
    // create's own onSuccess will re-sync history once it settles; that
    // refetch will then bring the row back unless the user re-cancels with
    // its real id. Documented limitation.
    if (data?.synthetic) return
    qc.invalidateQueries({ queryKey: requestFlowKeys.history() })
  },
})
```

**Optimistic-cancel guard rationale:** Without short-circuit, user clicking × during the create-request in-flight window sends `DELETE /api/requests/__optimistic-<uuid>` → plugin returns `mcp.target_not_found` → 404 toast. UI gate alone (disable button) is preferred but not enough — derived `requestId` may briefly be the optimistic one. Belt-and-braces: gate UI in C.4/C.5 AND short-circuit in mutationFn.

**Limitation — synthetic cancel ≠ true cancel:** A short-circuited cancel only filters local cache; the in-flight `POST /api/requests` is NOT aborted. When that create settles, `useCreateRequest.onSuccess` invalidates `history()` → server returns the (real) just-created row → it reappears in UI as pending. User must re-click cancel, this time on the real id. Acceptable: UI gates the button while optimistic, so this race only fires if `startsWith` derivation lags (unlikely). Documented to keep implementer from "fixing" by force-aborting the create — that adds AbortController plumbing for a corner case.

### C.8 Prefetch — ⊕ history

→ [apps/client/src/features/media-detail/components/media-detail-page.tsx:84-91](../apps/client/src/features/media-detail/components/media-detail-page.tsx#L84-L91)

```ts
useEffect(() => {
  if (!mediaType) return
  queryClient.prefetchQuery({ queryKey: requestFlowKeys.targets(mediaType), ...,
                              staleTime: REQUEST_TARGETS_STALE_MS })
  queryClient.prefetchQuery({ queryKey: requestFlowKeys.history(),
                              queryFn: () => requestsApi.history(),
                              staleTime: 30_000 })   // NEW
}, [mediaType, queryClient])
```

First detail open → both warm before user clicks request.

### C.9 `index.ts` ⊕

Export `useUserRequests`, `useCancelRequest`. No removals.

---

## §E Edge cases

| Case | Behavior |
|------|---------|
| Request approved upstream (`available` row) + wire `item.status` flips | Map `available`→`available`. Both sources agree. |
| Failed/declined row | Mapped to `null` → re-request enabled. |
| Cancel mid-flight + focus refetch | Optimistic remove → no flicker. Invalidate on 2xx. Rollback + toast on err. |
| Multiple seerr connections | `strategy=single` → one wins for both list + cancel. Consistent. |
| Movie row | `seasons: []` always. Selector ignores `seasonNumber` arg for movies. |
| History fetch fails | UI falls back to wire `item.status`. No toast. Silent. |
| Optimistic id collision | UUID-prefixed `__optimistic-…` → never matches real id from server. |
| Cancel during optimistic window | UI: disable × while `requestId.startsWith("__optimistic-")` (tooltip "submitting…"). Hook: `mutationFn` short-circuits — local cache filter only, no server call. See C.7. |
| Popover unmount on optimistic flip | Intended. `setStatus("pending")` removed from submit handler; derived render at [movie-request-action.tsx:66](../apps/client/src/features/request-flow/components/movie-request-action.tsx#L66) swaps `<Popover>`→`<RequestStatusInline>` immediately on `onMutate` cache write. Same for season picker. |
| `getRequests` swallow→throw | Verified single consumer: [apps/server/src/api/procedures/requests.ts:17](../apps/server/src/api/procedures/requests.ts#L17). Safe to surface errors. |

## §M Error map ⊕

| Status | Code | Trigger | Toast |
|--------|------|---------|-------|
| 404 | `request.unknown_service` | cancel: conn missing/disabled/cap-not-impl | `request_error_unknown_service` |
| 502 | `request.provider_failed` | cancel: plugin `{ok:false}` OR plugin err | `request_error_provider_failed` |
| else | — | net / 5xx / unknown | `request_error_generic` |

DELETE inherits same map as POST. Same toast keys. Same `RequestError` class.

## §T Tests

**SDK** → schema includes `seasons[]`, `targetLabel`, `profileLabel`.

**Seerr** → `listRequests` maps seasons + labels; movie row has `seasons:[]`.

**Server** → `apps/server/src/api/procedures/__tests__/requests.test.ts`:
- GET `/` typed shape (existing test: tighten assert).
- DELETE `/:id` happy → `{ok:true}`; 404 unknown_service; 502 provider_failed.
- `failed` rows passthrough (not filtered).

**Service** → `apps/server/src/media/__tests__/service.request-flow.test.ts`:
- `cancelRequest` dispatch + error map (mirror `requestDownload` cases).
- `getRequests` parse-typed throws on schema mismatch.

**Client** → `apps/client/src/features/request-flow/__tests__/`:
- `movie-request-action.test.tsx`: mock history with matching tmdbId → renders pending after mount (no submit). Reload sim = remount.
- `requestable-seasons.test.tsx`: per-season pending derived; only matching season marked.
- New: `failed-row-allows-retry.test.tsx`: `status:"failed"` row → button still renders.
- New: `cancel-flow.test.tsx`: optimistic remove + server hit + invalidate; rollback on err.
- New: `cancel-during-optimistic.test.tsx`: cancel pressed before create-request settles → no `DELETE /api/requests/__optimistic-…` request fired; cache cleaned locally; subsequent invalidate consistent.
- New: `pending-persistence.test.tsx`: simulate reload (unmount/remount) → still pending.

## §O Out of scope (still)

Polling. Push notif. History page UI. Multi-target fan-out. Root/tag/lang pickers.

## §D Decisions resolved

1. State source = server-derived (single source of truth) — ✓
2. Season granularity via `listRequests.output ⊕ seasons[]` — ✓
3. Refetch = mount + focus + post-submit invalidate (no polling) — ✓
4. Cancel server-real via new `DELETE /api/requests/:id` — ✓
5. `failed`/declined rows → drop (re-request enabled) — ✓
6. Movie cancel UI added for symmetry w/ seasons — ✓
7. Destination labels persisted via `listRequests.output ⊕ targetLabel/profileLabel` — ✓
