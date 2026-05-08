# Request flow: wire UI to real API

**Issue:** [#216](https://github.com/electather/media-manager/issues/216) — request-flow submissions only update local UI state and do not call the request API.

## Background

The request-flow UI ([apps/client/src/features/request-flow/](apps/client/src/features/request-flow/)) renders movie and per-season request actions but never calls the server. `POST /api/requests` is a stub returning `{ success: false, message: "Not implemented" }` ([apps/server/src/api/procedures/requests.ts](apps/server/src/api/procedures/requests.ts)). The client `RequestPayload` shape in [lib/types.ts](apps/client/src/features/request-flow/lib/types.ts) does not match the shared schema in [packages/shared/src/media/schemas.ts](packages/shared/src/media/schemas.ts). The picker reads service + profile data from a hard-coded mock (`lib/mock-services.ts`).

Plumbing already exists for the underlying call: `MediaService.requestDownload` ([apps/server/src/media/service.ts:206](apps/server/src/media/service.ts#L206)) dispatches the `mediaRequest@v1.createRequest` capability, currently implemented by [packages/plugins/seerr](packages/plugins/seerr) only.

## Goals

- Real submission path for movie, single-season, and bulk-season requests.
- Server-truthful target list: services + per-service quality profiles surface from plugin response, conditioned on media type, no mock data.
- UI advances to `pending` / `in-progress` only on server success; failures surface without mutating local status.
- `POST /api/requests` and `GET /api/requests` both wired; shared schema and client agree.

## Non-goals

- Root folder, tag, language profile selection (Radarr/Sonarr expose them; deferred).
- Request history page UI.
- Cancel / retry flows.
- Push notifications on request status change.
- New plugin instance management UX.

## API contract

### `GET /api/requests/targets?mediaType=movie|tv`

Returns the user-visible list of services the requested media type can route to. One entry per (connection × downstream target). Empty `targets` is a valid response (the client renders an empty-state).

```ts
// packages/shared/src/media/schemas.ts (new)
export const requestProfileSchema = z.object({
  id: z.string(),
  label: z.string(),
  detail: z.string().optional(),
});

export const requestTargetSchema = z.object({
  serviceId: z.string(),                   // opaque host-encoded id, see below
  pluginId: z.string(),                    // for grouping in UI
  label: z.string(),
  exposesProfiles: z.boolean(),
  defaultProfileId: z.string().nullable(),
  profiles: z.array(requestProfileSchema),
});

export const requestTargetsResponseSchema = z.object({
  targets: z.array(requestTargetSchema),
});
export type RequestTargetsResponse = z.infer<typeof requestTargetsResponseSchema>;
```

`serviceId` is host-encoded as `${connectionId}:${pluginTargetId}` where:
- `connectionId` is a UUID from `service_connections`.
- `pluginTargetId` is plugin-controlled and constrained to `[A-Za-z0-9_-]+` (no colons).

Plugins do not see `serviceId`; the host composes it from `connectionId` + the `targetId` returned by the plugin. The client treats `serviceId` as opaque.

### `POST /api/requests`

Request body (replaces existing `createMediaRequestSchema`):

```ts
// packages/shared/src/media/schemas.ts
export const createMediaRequestSchema = z.object({
  tmdbId: z.string().min(1),
  mediaType: z.enum(MEDIA_TYPES),
  serviceId: z.string().min(1),
  profileId: z.string().nullable().optional(),
  seasons: z.array(z.number().int().positive()).optional(),
});

export const createMediaRequestResponseSchema = z.object({
  requestId: z.string().nullable(),
});
```

Constraints enforced by zod:
- `seasons` only meaningful when `mediaType === "tv"`. Server ignores when `mediaType === "movie"` (and emits a warning log; not a 400).
- `profileId` may be null when the resolved target has `exposesProfiles === false`.

Errors via existing `HttpError`:

| Status | Code                       | Trigger                                                      |
| ------ | -------------------------- | ------------------------------------------------------------ |
| 400    | `request.invalid_input`    | zod validation fails (existing helper).                      |
| 404    | `request.unknown_service`  | `serviceId` decodes to a connection not owned/enabled for caller. |
| 422    | `request.invalid_profile`  | Target requires a profile and `profileId` is missing or unknown. |
| 502    | `request.provider_failed`  | Plugin call returns `success:false` or throws `PluginCallError`. |

Response on success: `200 { requestId: string | null }`. `requestId` is the plugin-returned id; null when the plugin reports success but no id (rare but possible per current `mediaRequest@v1.createRequest` schema).

### `GET /api/requests`

Wire to `MediaService.getRequests()`. Response unchanged from existing stub `{ items: unknown[] }` for now; tightening the schema is out of scope for this PR (no UI consumer yet).

## Plugin SDK

### `mediaRequest@v1.listTargets` (new method)

```ts
// packages/plugin-sdk/src/capabilities/media-request.ts
listTargets: method(
  z.object({ type: mediaType }),
  z.object({
    targets: z.array(z.object({
      targetId: z.string().regex(/^[A-Za-z0-9_-]+$/),
      label: z.string(),
      exposesProfiles: z.boolean(),
      defaultProfileId: z.string().nullable(),
      profiles: z.array(z.object({
        id: z.string(),
        label: z.string(),
        detail: z.string().optional(),
      })),
    })),
  }),
  { defaultCacheTtlSec: 5 * MIN, optional: true },
),
```

Marked `optional: true` so plugins implementing `mediaRequest` (currently only seerr) do not break compile. Host treats absence as "this plugin contributes zero targets".

### `mediaRequest@v1.createRequest` (extend existing input)

```ts
createRequest: method(
  z.object({
    tmdbId: z.string(),
    type: mediaType,
    seasons: z.string().optional(),
    targetId: z.string().optional(),       // new
    profileId: z.string().optional(),      // new
  }),
  z.object({
    success: z.boolean(),
    requestId: z.string().optional(),
    message: z.string().optional(),
  }),
  { invalidates: ["mediaRequest@v1"] },
),
```

Plugins that ignore `targetId` / `profileId` continue to work (current seerr behavior — falls back to Overseerr's default server selection).

### Seerr plugin implementation

- `listTargets({type})`:
  - `GET /api/v1/service/radarr` (movie) or `/api/v1/service/sonarr` (tv).
  - Each entry → one `target` with `targetId = String(server.id)`, `label = server.name`, `exposesProfiles = true`.
  - For each server, `GET /api/v1/service/radarr/{id}` (resp. sonarr) returns `profiles: { id, name }[]`. Map to `{id: String(id), label: name}`.
  - `defaultProfileId` from server's `activeProfileId`.
- `createRequest({..., targetId, profileId})`:
  - Forward `serverId = Number(targetId)` and `profiles: { profileId: Number(profileId) }` to Overseerr's `POST /request` body. Existing seasons handling unchanged.
  - When `targetId` absent, current behavior preserved.

## Server architecture

### Dispatch path: connection-targeted invocation

`DispatchRequest.connectionId` is added (optional). When set, `dispatchSingle` resolves that exact connection rather than falling back to default-first. Implementation:

```ts
// apps/server/src/media/strategies/single.ts
const conn = req.connectionId
  ? await pickConnectionById(req.userId, pluginId, req.connectionId)
  : await pickSingleConnection(req.userId, pluginId);
```

`pickConnectionById(userId, pluginId, connectionId)` (new in [capability-lookup.ts](apps/server/src/media/capability-lookup.ts)) returns the connection only if it is enabled and owned by `userId`; otherwise returns `null` and the procedure surfaces `request.unknown_service`.

### `MediaService.listRequestTargets(mediaType)` (new)

```ts
async listRequestTargets(mediaType: "movie" | "tv"): Promise<RequestTarget[]> {
  const providers = capabilityRegistry.providersOf("mediaRequest@v1");
  const out: RequestTarget[] = [];
  for (const pluginId of providers) {
    const conns = await resolveConnections(this.userId, pluginId);
    for (const conn of conns.filter((c) => c.kind === "user")) {
      const result = await dispatchSingle<ListTargetsOutput>({
        userId: this.userId,
        capability: "mediaRequest",
        version: "v1",
        method: "listTargets",
        input: { type: mediaType },
        pluginId,
        connectionId: conn.connectionId,
      }).catch(() => null);
      if (!result) continue;
      for (const t of result.targets) {
        out.push({
          serviceId: `${conn.connectionId}:${t.targetId}`,
          pluginId,
          label: t.label,
          exposesProfiles: t.exposesProfiles,
          defaultProfileId: t.defaultProfileId,
          profiles: t.profiles,
        });
      }
    }
  }
  return out;
}
```

Failures from any single connection are logged and skipped (`.catch(() => null)`) so one broken Seerr instance does not blank the whole picker. The list is never cached at the host edge — `dispatchSingle` already honors the capability's `defaultCacheTtlSec: 5 * MIN`.

### `MediaService.requestDownload` (rewrite)

```ts
async requestDownload(input: CreateMediaRequestBody): Promise<{ requestId: string | null }> {
  const [connectionId, targetId] = decodeServiceId(input.serviceId);   // throws on bad shape
  const conn = await pickConnectionById(this.userId, /* pluginId */, connectionId);
  if (!conn) throw new HttpError(404, "request.unknown_service", "...");

  const seasonsCsv = input.seasons?.length ? input.seasons.join(",") : undefined;

  const result = await dispatchSingle<CreateRequestOutput>({
    userId: this.userId,
    capability: "mediaRequest",
    version: "v1",
    method: "createRequest",
    input: {
      tmdbId: input.tmdbId,
      type: input.mediaType,
      seasons: seasonsCsv,
      targetId,
      profileId: input.profileId ?? undefined,
    },
    pluginId: conn.pluginId,
    connectionId,
    skipCache: true,
  });

  if (!result || !result.success) {
    throw new HttpError(502, "request.provider_failed", result?.message ?? "provider failed");
  }
  return { requestId: result.requestId ?? null };
}
```

`pluginId` is recovered from the connection row (the connection knows its plugin). `decodeServiceId` is a small helper exported from `apps/server/src/media/service-id.ts`.

### Procedures

[apps/server/src/api/procedures/requests.ts](apps/server/src/api/procedures/requests.ts) becomes:

```ts
export const requestsApp = new Hono()
  .get("/", async (c) => {
    const svc = mediaServiceFor(c);
    const items = await svc.getRequests();
    return c.json({ items });
  })
  .get("/targets", zValidator("query", requestTargetsQuerySchema), async (c) => {
    const svc = mediaServiceFor(c);
    const targets = await svc.listRequestTargets(c.req.valid("query").mediaType);
    return c.json({ targets });
  })
  .post("/", zValidator("json", createMediaRequestSchema), async (c) => {
    const svc = mediaServiceFor(c);
    const result = await svc.requestDownload(c.req.valid("json"));
    return c.json(result);
  });
```

`mediaServiceFor(c)` follows the established pattern used by sibling procedures (e.g. [home.ts](apps/server/src/api/procedures/home.ts)). HttpErrors propagate via the existing global error middleware.

## Client architecture

### Shared schema as source of truth

`apps/client/src/features/request-flow/lib/types.ts` deletes `RequestPayload`. Components consume `CreateMediaRequestBody` and `RequestTarget` from `@ent-mcp/shared/media`. `RequestService` / `RequestProfile` / `mock-services.ts` deleted.

### React Query hooks

New folder `apps/client/src/features/request-flow/api/`:

- `query-keys.ts` — `requestFlow.targets(mediaType)` and `requestFlow.history()` factories.
- `use-request-targets.ts` — `useSuspenseQuery({ queryKey: requestFlow.targets(mediaType), queryFn: api.requests.targets, staleTime: 5 * 60_000 })`. Returns array of `RequestTarget`.
- `use-create-request.ts` — `useMutation({ mutationFn: api.requests.create, onSuccess: invalidate(requestFlow.targets), onError: toastFromError })`.
- `errors.ts` — `RequestError extends Error` carrying `code` + `field?` from server payload.

### Picker rewire

[components/request-picker.tsx](apps/client/src/features/request-flow/components/request-picker.tsx) loses its `services` / `userRole` props. Internally calls `useRequestTargets(kind)` and renders the returned list. The existing conditional `service.exposesProfiles && service.profiles.length > 0` ([request-picker.tsx:82](apps/client/src/features/request-flow/components/request-picker.tsx#L82)) keeps gating profile UI.

### Submit handlers

[movie-request-action.tsx](apps/client/src/features/request-flow/components/movie-request-action.tsx) and [requestable-seasons.tsx](apps/client/src/features/request-flow/components/requestable-seasons.tsx) replace the local-status-then-toast pattern:

```ts
const create = useCreateRequest();
const onSubmit = async (payload: CreateMediaRequestBody) => {
  try {
    await create.mutateAsync(payload);
    setLocalStatus("pending");        // only after success
    toast({ title: "Request submitted" });
    closePopover();
  } catch (err) {
    toast({ variant: "destructive", title: errorTitle(err), description: err.message });
    // local status untouched.
  }
};
```

For per-season and bulk submissions in `requestable-seasons.tsx`, every season number selected in the picker becomes one entry in `seasons[]` of a single `POST /api/requests`. Bulk submit is one request, not N.

The optional `onSubmit` / `onSeasonSubmit` / `onBulkSubmit` props remain for storybook / __tests__ harnesses but no longer drive production behavior.

### Prefetch timing

The media-detail page (consumer of request-flow) prefetches targets at route load:

```ts
// in media-detail loader / route component
queryClient.prefetchQuery({
  queryKey: requestFlow.targets(media.type),
  queryFn: () => api.requests.targets({ mediaType: media.type }),
  staleTime: 5 * 60_000,
});
```

Cache key is `mediaType`-scoped (movie or tv), so visiting any movie detail warms the cache for every other movie detail in the session. First picker open hits the warm cache instantly.

## Error handling: client side

`api.requests.create` parses error responses into `RequestError`:

| Server code               | Toast title                       |
| ------------------------- | --------------------------------- |
| `request.invalid_input`   | "Couldn't submit — invalid input" |
| `request.unknown_service` | "Selected server is unavailable"  |
| `request.invalid_profile` | "Pick a quality profile"          |
| `request.provider_failed` | "Provider couldn't take request"  |
| anything else / network   | "Something went wrong"            |

No toast variant differs by category; copy variation alone signals severity.

## Testing

### Server (vitest)

- `apps/server/src/api/procedures/__tests__/requests.test.ts`:
  - GET `/api/requests` returns `{items}` from MediaService.
  - GET `/api/requests/targets?mediaType=movie` returns aggregated targets, drops broken connections.
  - POST `/api/requests` happy path → `{requestId}`, calls `MediaService.requestDownload` once with decoded args.
  - POST 400 for malformed body, 404 for unknown service, 422 when target requires profile and none provided, 502 on provider failure.
- `apps/server/src/media/__tests__/service.request-flow.test.ts`:
  - `listRequestTargets` aggregates across connections; failed connection skipped.
  - `requestDownload` decodes `serviceId`, calls `dispatchSingle` with the right `pluginId` + `connectionId`.

### Plugin SDK (vitest)

- `packages/plugin-sdk/src/capabilities/__tests__/media-request.test.ts` — schema snapshot covering new `listTargets` shape and extended `createRequest` input.

### Seerr plugin (vitest)

- `packages/plugins/seerr/__tests__/media-request.test.ts` extended:
  - `listTargets` for movie hits `/service/radarr` then per-server `/service/radarr/{id}` and maps profiles.
  - `createRequest` forwards `serverId`+`profiles.profileId` when `targetId`+`profileId` provided.

### Client (vitest + RTL)

- `apps/client/src/features/request-flow/__tests__/movie-request-action.test.tsx`:
  - Submit success → status flips to `pending`, toast shown.
  - Submit failure (mocked 502) → status stays `available`, destructive toast shown.
  - Validation 400 → toast says "invalid input", status untouched.
- `apps/client/src/features/request-flow/__tests__/requestable-seasons.test.tsx`:
  - Single-season submit posts `seasons:[2]`.
  - Bulk submit posts one request with `seasons:[1,2,3]`.
  - Failure leaves all seasons in original status.
- `apps/client/src/features/request-flow/__tests__/request-picker.test.tsx`:
  - Targets cached at media-detail mount → picker open shows them with zero loading state.
  - Empty `targets` array shows the empty-state copy.
  - Profile selector hidden when `exposesProfiles === false`.

### Regression

Per memory #17 (regression tests for reported bugs), add `apps/client/src/features/request-flow/__tests__/issue-216-no-mutation.test.tsx`: asserts `useCreateRequest`'s `mutateAsync` is invoked when the user submits — a focused reproducer of the original bug.

## Migration / breakage

- Pre-stable: shared schema breaks freely (memory #20). No migration path needed for `RequestPayload`.
- Plugin SDK: `mediaRequest@v1.listTargets` is `optional: true`; no plugin breaks. `createRequest` input gains optional fields; old plugins ignore them.
- Seerr plugin: only consumer; updated in this PR.
- Client mocks (`mock-services.ts`) deleted; nothing imports them outside the feature.

## Out of scope

Listed under non-goals; tracked in follow-up issues if they surface during review:
- Root folder / tag / language profile pickers.
- Request history page UI.
- Cancel / retry of in-flight requests.
- Multi-target fan-out (one request to two servers at once).

## Open questions

None at design time; all five contract decisions resolved through brainstorming:
1. `serviceId` + `profileId` flow server-side and route via plugin → confirmed.
2. Wire format: split fields with `seasons: number[]` → confirmed.
3. Capability shape: extend `mediaRequest@v1` with `listTargets`, host injects `serviceId` from connection + plugin target → confirmed.
4. Errors: HTTP 4xx/5xx + structured body via `HttpError` → confirmed.
5. `GET /api/requests` in scope, wired to `MediaService.getRequests` → confirmed.
