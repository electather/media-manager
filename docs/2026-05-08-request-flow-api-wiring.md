# Request flow API wiring

**Status:** shipped. Issue [#216](https://github.com/electather/nama/issues/216), PR #240. Commits `0c2e024`, `85ecfa5`, `6d0bb2d`.

Caveman ultra. Pseudocode = source-of-truth shape, not literal.

## Scope shipped

- Movie + per-season + bulk-season submit hit `POST /api/requests`.
- Picker reads live targets from `GET /api/requests/targets?mediaType=`.
- Status flips local only on server 2xx. Failure → toast, status untouched.
- `GET /api/requests` wired (loose `{items}` shape; typed history out of scope).
- Mock services deleted. Shared schema = sole truth.

## Wire format → [packages/shared/src/media/schemas.ts](packages/shared/src/media/schemas.ts)

```ts
createMediaRequestSchema = { tmdbId, mediaType, serviceId, profileId?: nullable, seasons?: int[] }
createMediaRequestResponseSchema = { requestId: string|null }
requestProfileSchema = { id, label, detail? }
requestTargetSchema = { serviceId, pluginId, label, exposesProfiles, defaultProfileId: nullable, profiles[] }
requestTargetsResponseSchema = { targets[] }
requestTargetsQuerySchema = { mediaType }
```

`serviceId` host-encoded `${connectionId}:${pluginTargetId}`. Opaque on client. Plugins never see it.

## serviceId codec → [apps/server/src/media/service-id.ts](apps/server/src/media/service-id.ts)

```
TARGET_ID_RE = /^[A-Za-z0-9_-]+$/
encode(connId, targetId) = `${connId}:${targetId}`
decode(s):
  i = s.indexOf(":")
  if i<=0 || i==len-1: null
  conn, tid = split @ i
  if !TARGET_ID_RE.test(tid): null
  return {connId: conn, targetId: tid}
```

## Server procedures → [apps/server/src/api/procedures/requests.ts](apps/server/src/api/procedures/requests.ts)

```
requestsApp = Hono.use("*", requireSession)
  .GET("/")                          → svc.getRequests() → {items}
  .GET("/targets", zVal(query))      → svc.listRequestTargets(mediaType) → {targets}
  .POST("/",       zVal(json))       → svc.requestDownload(body) → {requestId}
```

## MediaService → [apps/server/src/media/service.ts:226](apps/server/src/media/service.ts#L226)

```
requestDownload(input):
  decoded = decodeServiceId(input.serviceId)
  if !decoded: throw badRequest("request.invalid_input", "malformed serviceId")
  {connId, targetId} = decoded
  if mediaType=="movie" && seasons?.length: warn (drop, not 400)
  seasonsCsv = mediaType=="tv" && seasons.length ? seasons.join(",") : undef
  try:
    result = dispatchToConnection({
      userId, connectionId: connId,
      capability: "mediaRequest", version: "v1", method: "createRequest",
      input: { tmdbId, type: mediaType, seasons: seasonsCsv, targetId, profileId? }
    })
  catch PluginCallError e:
    "mcp.target_not_found"                              → 404 request.unknown_service
    "plugin.input_invalid"|"upstream_error"|"timeout"   → 502 request.provider_failed
    else                                                → rethrow (→ 500)
  if !result || !result.success: throw 502 request.provider_failed
  return { requestId: result.requestId ?? null }

listRequestTargets(mediaType):                          // service.ts:284
  eligible = listEligibleConnections(userId, "mediaRequest", "v1")
  // parallel fan-out — one slow Seerr blocks zero peers
  settled = await Promise.allSettled(eligible.map(c =>
    dispatchToConnection({ userId, connectionId: c.connectionId,
      capability:"mediaRequest", version:"v1", method:"listTargets",
      input: { type: mediaType } })))
  out = []
  for (i, r) in settled:
    if rejected: warn(pluginId, connId, err); continue
    if !r.value: continue
    for t in r.value.targets:
      if !TARGET_ID_RE.test(t.targetId): warn drop; continue
      out.push({
        serviceId: encodeServiceId(c.connectionId, t.targetId),
        pluginId, label, exposesProfiles, defaultProfileId, profiles })
  return out
```

Notes:
- `dispatchToConnection` skips dispatch cache by design. Freshness owned by React Query.
- Per-connection rejects swallowed → empty list valid. Picker renders empty-state.
- Per-target regex check defends against version skew even though SDK schema enforces same regex.
- `getRequests()` catches `PluginCallError("media.no_connection")` → `[]`; other throws propagate. Loose `{items}` shape intentional, history schema = follow-up.

## Plugin SDK → [packages/plugin-sdk/src/capabilities/media-request.ts](packages/plugin-sdk/src/capabilities/media-request.ts)

```
mediaRequest@v1.createRequest input ⊕= { targetId?: string, profileId?: string }

mediaRequest@v1.listTargets (optional:true):
  in:  { type: mediaType }
  out: { targets: Array<{
    targetId: regex /^[A-Za-z0-9_-]+$/, label, exposesProfiles,
    defaultProfileId: nullable, profiles: [{id, label, detail?}] }> }
```

Capability-level `defaultCacheTtlSec` irrelevant on this path — targeted dispatch never reads/writes dispatch cache.

## Seerr plugin → [packages/plugins/seerr/src/capabilities/media-request.ts](packages/plugins/seerr/src/capabilities/media-request.ts)

```
listTargets({type}):
  root = type=="movie" ? "/service/radarr" : "/service/sonarr"
  servers = GET root                          // [{id, name, activeProfileId?}]
  for srv in servers:
    detail = GET `${root}/${srv.id}`          // {profiles:[{id,name}]}
    push { targetId: String(srv.id), label: srv.name, exposesProfiles: true,
           defaultProfileId: srv.activeProfileId!=null ? String(...) : null,
           profiles: detail.profiles.map(p=>({id:String(p.id), label:p.name})) }
    // host-actionable err → throw; else skip this server
  on outer host-actionable rethrow → return { targets: [] }

createRequest({tmdbId, type, seasons, targetId, profileId}):
  body = { mediaType: type, mediaId: Number(tmdbId) }
  if type=="tv" && seasons:  body.seasons   = csv→int[]
  if targetId:               body.serverId  = Number(targetId)
  if profileId:              body.profileId = Number(profileId)   // top-level (defensive: Overseerr versions vary)
  POST /request body → { success:true, requestId: String(data.id) }
  catch host-actionable → throw; pluginErr → {success:false, message}
```

## Client → [apps/client/src/features/request-flow/](apps/client/src/features/request-flow/)

```
api/
  client.ts                requestsApi.{targets,create}; throws RequestError on !res.ok; parses w/ shared schemas
  errors.ts                class RequestError(status, body); toastFromError(err) → m.request_error_*()
  query-keys.ts            requestFlowKeys.{targets(mediaType), history()}
  use-request-targets.ts   useSuspenseQuery(staleTime=5min); export REQUEST_TARGETS_STALE_MS
  use-create-request.ts    useMutation(onError: toastFromError); NO invalidate(targets) by design

components/
  request-picker-boundary.tsx   <ErrorBoundary fallback=retry-resets-targets-cache><Suspense fallback=skeleton>
  request-picker.tsx            useRequestTargets(kind); profile UI gated on exposesProfiles && profiles.length>0
  movie-request-action.tsx      Popover→Boundary→Picker; on submit success: setStatus("pending"); toast; close
  season-request-action.tsx     same shell, per-season + bulk
  requestable-seasons.tsx       bulk = ONE POST w/ seasons:[…], not N
  destination-helpers.ts        label resolution
  request-status-{badge,inline}.tsx  status chrome

lib/
  types.ts                 local UI types only (RequestStatus, RequestDestination); RequestPayload removed
  request-helpers.ts       normalizeRequestStatus, tmdbIdFromItemId
```

## Submit handler shape

```
onSubmit(submission):
  try:
    await create.mutateAsync({ tmdbId, mediaType, serviceId, profileId? })
    setDestination({ serviceLabel, profileLabel })
    setStatus("pending")             // ONLY after server 2xx
    closePopover(); toast.success(...)
  catch:
    // useCreateRequest already toasted via toastFromError; status untouched
```

## Prefetch → [apps/client/src/features/media-detail/components/media-detail-page.tsx:84-91](apps/client/src/features/media-detail/components/media-detail-page.tsx#L84-L91)

```
useEffect(() => {
  if (!mediaType) return
  queryClient.prefetchQuery({
    queryKey: requestFlowKeys.targets(mediaType),
    queryFn: () => requestsApi.targets({ mediaType }),
    staleTime: REQUEST_TARGETS_STALE_MS   // 5min
  })
}, [mediaType, queryClient])
```

Same-mediaType visits warm session-wide cache. First picker open = zero loading state.

## Error map (server → client toast)

| Status | Code                       | Trigger                                          | Toast key                       |
| ------ | -------------------------- | ------------------------------------------------ | ------------------------------- |
| 400    | `request.invalid_input`    | zod fail OR malformed `serviceId`                | `request_error_invalid_input`   |
| 404    | `request.unknown_service`  | conn missing/disabled/cap-not-impl (mcp.target_not_found) | `request_error_unknown_service` |
| 422    | `media.no_connection`      | user has no connection for plugin (⊥ Seerr configured) | `request_error_generic`   |
| 502    | `request.provider_failed`  | plugin success:false OR plugin.{input_invalid,upstream_error,timeout} | `request_error_provider_failed` |
| else   | —                          | net / 5xx / unknown                              | `request_error_generic`         |

422 `request.invalid_profile` not emitted — plugin returns `success:false` w/ message → 502. Pre-validation against cached `listTargets` skipped (cache may be stale; trust upstream).

## Tests shipped

- [apps/server/src/api/procedures/__tests__/requests.test.ts](apps/server/src/api/procedures/__tests__/requests.test.ts) — GET items, GET targets aggregation + all-fail empty, POST happy/400/404/502, movie+seasons warn-and-drop.
- [apps/server/src/media/__tests__/service.request-flow.test.ts](apps/server/src/media/__tests__/service.request-flow.test.ts) — listRequestTargets aggregation/skip, illegal targetId drop, requestDownload decode + dispatch + error mapping.
- [packages/plugin-sdk/src/capabilities/__tests__/media-request.test.ts](packages/plugin-sdk/src/capabilities/__tests__/media-request.test.ts) — schema snapshot, listTargets + extended createRequest.
- [packages/plugins/seerr/__tests__/media-request.test.ts](packages/plugins/seerr/__tests__/media-request.test.ts) — listTargets radarr/sonarr fanout, createRequest serverId+profileId.
- [apps/client/.../movie-request-action.test.tsx](apps/client/src/features/request-flow/__tests__/movie-request-action.test.tsx) — success→pending+toast; failure→status untouched.
- [apps/client/.../requestable-seasons.test.tsx](apps/client/src/features/request-flow/__tests__/requestable-seasons.test.tsx) — single + bulk one-POST; failure leaves all original.
- [apps/client/.../issue-216-no-mutation.test.tsx](apps/client/src/features/request-flow/__tests__/issue-216-no-mutation.test.tsx) — regression: mutateAsync invoked on submit.
- [apps/client/.../request-helpers.test.ts](apps/client/src/features/request-flow/__tests__/request-helpers.test.ts) — helpers.

## Out of scope (still)

Root folder/tag/language profile pickers · request history page UI · cancel/retry · multi-target fan-out · push notif on status change · typed `GET /api/requests` schema (follow-up).

## Decisions resolved

1. `serviceId`+`profileId` server-side, plugin routes — ✓
2. Wire: split fields, `seasons: number[]` — ✓
3. Capability: `mediaRequest@v1` ⊕ `listTargets`; host injects `serviceId` — ✓
4. Errors: 4xx/5xx + structured body via `HttpError` — ✓
5. `GET /api/requests` wired to `MediaService.getRequests` (loose shape) — ✓
