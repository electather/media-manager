---
goal: Wire request-flow UI to real /api/requests endpoints with plugin-driven targets and quality profiles (issue #216)
version: 1.0
date_created: 2026-05-08
last_updated: 2026-05-08
owner: media-manager (Omid Astaraki)
status: 'Planned'
tags: [feature, bug, api, plugin-sdk, frontend]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

Implement the design at [docs/specs/2026-05-08-request-flow-api-wiring-design.md](../docs/specs/2026-05-08-request-flow-api-wiring-design.md). The request-flow UI today flips local React state and shows a success toast without contacting the server; this plan wires `POST /api/requests`, `GET /api/requests`, and a new `GET /api/requests/targets` route end-to-end. It extends the `mediaRequest@v1` plugin capability with a `listTargets` method, reuses the existing `dispatchToConnection` pipeline for connection-targeted invocation, and rewires the client to drop the mock service registry in favor of plugin-driven data.

## 1. Requirements & Constraints

- **REQ-001**: Movie, single-season, and bulk-season submissions must call `POST /api/requests` and only advance UI status on a successful response.
- **REQ-002**: `POST /api/requests` body shape is `{ tmdbId, mediaType, serviceId, profileId?, seasons? }` per shared schema; server validates with `zValidator`.
- **REQ-003**: `GET /api/requests/targets?mediaType=movie|tv` returns one entry per (user-connection × plugin-target) with `{ serviceId, pluginId, label, exposesProfiles, defaultProfileId, profiles[] }`.
- **REQ-004**: Server composes `serviceId` as `${connectionId}:${pluginTargetId}` where `pluginTargetId` matches `/^[A-Za-z0-9_-]+$/`. Targets failing the regex are dropped with a warning.
- **REQ-005**: `MediaService.requestDownload` rewritten to accept `CreateMediaRequestBody`; calls `dispatchToConnection` for the targeted connection.
- **REQ-006**: `MediaService.listRequestTargets` iterates `listEligibleConnections(userId, "mediaRequest", "v1")` and aggregates `dispatchToConnection<ListTargetsOutput>` results, skipping connections whose call rejects.
- **REQ-007**: Plugin SDK `mediaRequest@v1` gains an `optional: true` `listTargets` method and extends `createRequest` input with optional `targetId` + `profileId` fields.
- **REQ-008**: Seerr plugin implements `listTargets` for movie (Radarr) and tv (Sonarr) services and forwards `serverId` + `profiles.profileId` from `createRequest`.
- **REQ-009**: Client picker reads targets via `useSuspenseQuery` keyed `["request-flow", "targets", mediaType]`, prefetched on media-detail page mount with `staleTime: 5 * 60_000`.
- **REQ-010**: Client mutation `useCreateRequest` does NOT invalidate the targets cache on success.
- **REQ-011**: Picker mounts inside a `<Suspense>` + `<ErrorBoundary>` wrapper provided by a new `RequestPickerBoundary` component.
- **REQ-012**: All client mock data (`mock-services.ts`) and the `RequestPayload` / `RequestService` / `RequestProfile` types are deleted; components consume `CreateMediaRequestBody` and `RequestTarget` from `@ent-mcp/shared/media`.
- **REQ-013**: `GET /api/requests` is wired to `MediaService.getRequests()`; response shape stays `{ items: unknown[] }` (typing deferred).
- **SEC-001**: All three procedures sit behind `requireSession` middleware; `MediaService` is constructed per-request with the authenticated `sessionUserId(c)`.
- **SEC-002**: `decodeServiceId` returns `null` on malformed input; the procedure maps `null` to a 400 `request.invalid_input` so a malformed id never reaches the database.
- **CON-001**: No host-edge cache for `listTargets` — `dispatchToConnection` bypasses the dispatch cache by design; React Query owns freshness.
- **CON-002**: `mediaRequest@v1.createRequest` plugin-side schema continues to take `seasons: z.string().optional()`; the host serializes the `seasons: number[]` array to a comma-separated string only when `mediaType === "tv"`.
- **CON-003**: Pre-stable repo (memory #20) — shared schema and `MediaService.requestDownload` signature break freely, no compat shims.
- **GUD-001**: Use Vite+ commands only — `vp check`, `vp test`, never `vitest` / `oxlint` / `pnpm` directly (CLAUDE.md).
- **GUD-002**: Import test utilities from `vite-plus/test`, never from `vitest` (CLAUDE.md).
- **GUD-003**: Keep request-flow components decomposed; do not nest `components/<x>/<thing>/` (memory #17).
- **PAT-001**: Procedures follow the [search.ts](../apps/server/src/api/procedures/search.ts) / [discover.ts](../apps/server/src/api/procedures/discover.ts) pattern: `requireSession` on the sub-app, `new MediaService(sessionUserId(c))` per handler.
- **PAT-002**: React Query hooks live in `apps/client/src/features/request-flow/api/` with a `query-keys.ts` factory and a typed error class, mirroring the [notifications/settings](../apps/client/src/features/notifications/settings/) layout.
- **PAT-003**: Every PR adds Changesets entries per CLAUDE.md "Pull Requests and Versioning" (memory #11): one logical change per file, 1–2 plain-English sentences, past tense.

## 2. Implementation Steps

### Implementation Phase 1 — Shared schemas

- GOAL-001: Land the shared zod schemas and types so every later phase imports a single source of truth from `@ent-mcp/shared/media`.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | In `packages/shared/src/media/schemas.ts`, **replace** `createMediaRequestSchema` with `z.object({ tmdbId: z.string().min(1), mediaType: z.enum(MEDIA_TYPES), serviceId: z.string().min(1), profileId: z.string().nullable().optional(), seasons: z.array(z.number().int().positive()).optional() })`; export `CreateMediaRequestBody = z.infer<typeof createMediaRequestSchema>`. | | |
| TASK-002 | In the same file, add `createMediaRequestResponseSchema = z.object({ requestId: z.string().nullable() })` plus `CreateMediaRequestResponse` type. | | |
| TASK-003 | In the same file, add `requestProfileSchema = z.object({ id: z.string(), label: z.string(), detail: z.string().optional() })`, `requestTargetSchema = z.object({ serviceId, pluginId, label, exposesProfiles, defaultProfileId: z.string().nullable(), profiles: z.array(requestProfileSchema) })`, and `requestTargetsResponseSchema = z.object({ targets: z.array(requestTargetSchema) })`. Export inferred types `RequestProfile`, `RequestTarget`, `RequestTargetsResponse`. | | |
| TASK-004 | In the same file, add `requestTargetsQuerySchema = z.object({ mediaType: z.enum(MEDIA_TYPES) })` and `RequestTargetsQuery` type. | | |
| TASK-005 | Verify `packages/shared/src/media/index.ts` re-exports every new symbol (`createMediaRequestResponseSchema`, `CreateMediaRequestResponse`, `requestProfileSchema`, `RequestProfile`, `requestTargetSchema`, `RequestTarget`, `requestTargetsResponseSchema`, `RequestTargetsResponse`, `requestTargetsQuerySchema`, `RequestTargetsQuery`). Add re-exports if missing. | | |
| TASK-006 | Run `vp check` from repo root; resolve any type errors that surface in `apps/server` or `apps/client` consumers of the old `createMediaRequestSchema` (they should fail with explicit type errors, which guide later phases). Commit only the shared package change. | | |

### Implementation Phase 2 — Plugin SDK capability extension

- GOAL-002: Extend `mediaRequest@v1` with the `listTargets` method and add optional `targetId` / `profileId` fields to `createRequest`.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-007 | In `packages/plugin-sdk/src/capabilities/media-request.ts`, add a `listTargets` method to `MediaRequestV1.methods` using `method(input, output, { optional: true })` with input `z.object({ type: mediaType })` and output `z.object({ targets: z.array(z.object({ targetId: z.string().regex(/^[A-Za-z0-9_-]+$/), label: z.string(), exposesProfiles: z.boolean(), defaultProfileId: z.string().nullable(), profiles: z.array(z.object({ id: z.string(), label: z.string(), detail: z.string().optional() })) })) })`. | | |
| TASK-008 | In the same file, extend `createRequest`'s input schema by adding `targetId: z.string().optional()` and `profileId: z.string().optional()` to the existing object. Output schema unchanged. | | |
| TASK-009 | In `packages/plugin-sdk/src/capabilities/__tests__/media-request.test.ts` (create if missing), add a snapshot test that imports `MediaRequestV1` and asserts `MediaRequestV1.methods.listTargets.input.safeParse({ type: "movie" }).success === true`, the output schema rejects a target with `targetId: "bad:id"`, and `createRequest.input.safeParse({ tmdbId: "1", type: "movie", targetId: "1", profileId: "5" }).success === true`. | | |
| TASK-010 | Run `vp test packages/plugin-sdk` and `vp check`; resolve any failures. Commit the plugin-SDK changes. | | |

### Implementation Phase 3 — Seerr plugin implementation

- GOAL-003: Implement `listTargets` and extend `createRequest` in the Seerr plugin so the host has live data to aggregate.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-011 | In `packages/plugins/seerr/src/capabilities/media-request.ts`, add `async listTargets(ctx, input)`. Branch on `input.type`: for `"movie"` GET `/api/v1/service/radarr`, for `"tv"` GET `/api/v1/service/sonarr`. For each returned server, GET the per-server detail (`/api/v1/service/radarr/{id}` or `/api/v1/service/sonarr/{id}`). Map each server to one `target` with `targetId: String(server.id)`, `label: server.name`, `exposesProfiles: true`, `defaultProfileId: server.activeProfileId != null ? String(server.activeProfileId) : null`, and `profiles: detail.profiles.map(p => ({ id: String(p.id), label: p.name }))`. Wrap network errors in `if (isHostActionable(err)) throw err; return { targets: [] }` so a single misbehaving server does not poison the response. | | |
| TASK-012 | In the same file, extend `createRequest` to read `targetId` and `profileId` from `input`. When `targetId` is non-empty, include `serverId: Number(targetId)` in the POST body; when `profileId` is non-empty, include `profiles: { profileId: Number(profileId) }`. When either field is absent, behavior is identical to today. | | |
| TASK-013 | Add the new method export to `packages/plugins/seerr/src/plugin.ts` if the existing `mediaRequest` object spread already covers it, otherwise add `listTargets` to the `mediaRequest` literal so the plugin runtime sees it. | | |
| TASK-014 | Extend `packages/plugins/seerr/__tests__/media-request.test.ts` with: (a) `listTargets` for movies fans out to `/service/radarr` then `/service/radarr/{id}` and yields the expected mapped shape; (b) `listTargets` for tv hits `/service/sonarr` and `/service/sonarr/{id}`; (c) `createRequest` with `targetId: "2"` and `profileId: "7"` POSTs `{ mediaType, mediaId, serverId: 2, profiles: { profileId: 7 } }`; (d) `createRequest` with neither field POSTs the existing body. | | |
| TASK-015 | Run `vp test packages/plugins/seerr` and `vp check`. Commit Phase 3. | | |

### Implementation Phase 4 — Server (host) wiring

- GOAL-004: Implement `service-id` codec, `MediaService.listRequestTargets`, rewritten `MediaService.requestDownload`, and the three Hono routes.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-016 | Create `apps/server/src/media/service-id.ts` exporting `TARGET_ID_RE = /^[A-Za-z0-9_-]+$/`, `encodeServiceId(connectionId, targetId)`, and `decodeServiceId(serviceId): { connectionId: string; targetId: string } | null`. The decoder splits on the first `:`, validates `targetId` against the regex, and returns `null` on any malformed input. | | |
| TASK-017 | In `apps/server/src/media/service.ts`, **replace** the existing `requestDownload(idOrCombined: string, seasons?: string)` with `requestDownload(input: CreateMediaRequestBody): Promise<{ requestId: string | null }>`. Body matches the design's code block at `docs/specs/2026-05-08-request-flow-api-wiring-design.md` lines 226–276 verbatim — call `decodeServiceId`, throw `badRequest("request.invalid_input", "malformed serviceId")` on null, build `seasonsCsv` only when `mediaType === "tv"`, call `dispatchToConnection<{ success, requestId?, message? }>`, and map `PluginCallError` codes to `HttpError(404 | 502)` per the spec's catch block. | | |
| TASK-018 | In the same file, add `async listRequestTargets(mediaType: "movie" | "tv"): Promise<RequestTarget[]>`. Body matches the design's code block at lines 176–217 verbatim — call `listEligibleConnections(this.userId, "mediaRequest", "v1")`, fan out `dispatchToConnection<ListTargetsOutput>` per connection (catch and log per-connection failures), drop targets failing `TARGET_ID_RE`, and return the flat array. | | |
| TASK-019 | In the same file, add the necessary imports: `dispatchToConnection`, `listEligibleConnections` from `./connection-targeted`; `decodeServiceId` from `./service-id`; `PluginCallError` from `./errors`; `HttpError`, `badRequest` from `../errors/http-errors`; `CreateMediaRequestBody`, `RequestTarget` from `@ent-mcp/shared/media`; `log` from `../logging`. Remove unused imports (the old `dispatchSingle` import for `requestDownload` may still be used elsewhere — leave it intact if other call sites remain). | | |
| TASK-020 | **Rewrite** `apps/server/src/api/procedures/requests.ts` to match the design's code block at lines 287–314: `requireSession` middleware on the sub-app, `GET /` calls `svc.getRequests()`, `GET /targets` validates query with `requestTargetsQuerySchema` and calls `svc.listRequestTargets(...)`, `POST /` validates body with `createMediaRequestSchema` and calls `svc.requestDownload(...)`. Construct `MediaService` per handler with `new MediaService(sessionUserId(c))`. | | |
| TASK-021 | In `apps/server/src/errors/http-errors.ts`, verify factory helpers `notFound`, `unprocessable` exist; add a `requestProviderFailed` helper if they do not exist already (or use `new HttpError(502, "request.provider_failed", message)` inline — pick whichever matches existing conventions in `apps/server/src/errors/http-errors.ts`). | | |
| TASK-022 | Confirm `apps/server/src/api/index.ts` (or wherever the API router mounts sub-apps) already mounts `requestsApp`. If not, add `app.route("/api/requests", requestsApp)` next to the existing route mounts. | | |
| TASK-023 | Add `apps/server/src/media/__tests__/service.request-flow.test.ts` covering the four bullets in the spec's "Server (vitest)" section: `listRequestTargets` aggregation, broken-connection skip, illegal-targetId drop, `requestDownload` happy path with correct decoded args, error mapping for `mcp.target_not_found`, `plugin.input_invalid`, `plugin.upstream_error`, `plugin.timeout`. Mock `dispatchToConnection` and `listEligibleConnections` via `vi.mock`. | | |
| TASK-024 | Add `apps/server/src/api/procedures/__tests__/requests.test.ts` covering: GET `/`, GET `/targets` happy path, GET `/targets` returns `{ targets: [] }` when every connection fails, POST happy path, POST 400 (malformed body, malformed `serviceId`), POST 404, POST 422, POST 502, POST `mediaType: "movie"` + `seasons: [1]` succeeds and emits a warning log. Mock `MediaService` via the existing pattern in [search.test.ts](../apps/server/src/api/procedures/__tests__/search.test.ts). | | |
| TASK-025 | Run `vp test apps/server` and `vp check`. Commit Phase 4. | | |

### Implementation Phase 5 — Client API + React Query hooks

- GOAL-005: Build the `features/request-flow/api/` module: API client functions, query-key factory, typed error class, and React Query hooks.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-026 | Create `apps/client/src/features/request-flow/api/query-keys.ts` exporting `requestFlow = { all: ["request-flow"] as const, targets: (mediaType: "movie" | "tv") => ["request-flow", "targets", mediaType] as const, history: () => ["request-flow", "history"] as const }`. | | |
| TASK-027 | Create `apps/client/src/features/request-flow/api/errors.ts` exporting `class RequestError extends Error { constructor(public code: string, message: string, public field?: string) { super(message); } }` plus a `toastFromError(err: unknown)` helper that maps `code` → toast title per the design's "Error handling: client side" table (lines 393–399). | | |
| TASK-028 | Create `apps/client/src/features/request-flow/api/client.ts` exporting `requestsApi.targets({ mediaType })` and `requestsApi.create(body: CreateMediaRequestBody)`. Both hit `/api/requests/...` via the project's existing fetch wrapper (mirror the pattern in [apps/client/src/features/notifications](../apps/client/src/features/notifications/) — likely `apps/client/src/api/client.ts` or similar). On non-2xx, parse the structured `{ error: { code, message } }` body and throw a `RequestError`. | | |
| TASK-029 | Create `apps/client/src/features/request-flow/api/use-request-targets.ts` exporting `useRequestTargets(mediaType)` that calls `useSuspenseQuery({ queryKey: requestFlow.targets(mediaType), queryFn: () => requestsApi.targets({ mediaType }), staleTime: 5 * 60_000 })` and returns `data.targets`. | | |
| TASK-030 | Create `apps/client/src/features/request-flow/api/use-create-request.ts` exporting `useCreateRequest()` that calls `useMutation({ mutationFn: requestsApi.create, onError: toastFromError })`. **Do NOT** add `onSuccess` cache invalidation. | | |
| TASK-031 | Update `apps/client/src/features/request-flow/index.ts` to re-export from `./api` (specifically `useRequestTargets`, `useCreateRequest`, `requestFlow` keys, `RequestError`). | | |
| TASK-032 | Run `vp check`. Commit Phase 5. | | |

### Implementation Phase 6 — Client UI rewire

- GOAL-006: Drop mock services, rewire the picker to read from `useRequestTargets`, wrap it in a Suspense + ErrorBoundary, and switch submit handlers to the real mutation.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-033 | Delete `apps/client/src/features/request-flow/lib/mock-services.ts` and remove every import of `SERVICES` / `userRoleServices` across the feature. | | |
| TASK-034 | In `apps/client/src/features/request-flow/lib/types.ts`, **delete** `RequestPayload`, `RequestService`, `RequestProfile`, `RequestDestination`, `ServiceGlyph`, and `UserRole`. Keep `Episode`, `EpisodeStatus`, `Season`, `RequestStatus` (UI-local only). | | |
| TASK-035 | Update `apps/client/src/features/request-flow/lib/destination-helpers.ts` and `lib/request-helpers.ts` to import `RequestTarget`, `RequestProfile` from `@ent-mcp/shared/media`. Drop helpers that referenced the now-deleted types; if a helper has no callers after the rewire, delete it. | | |
| TASK-036 | Create `apps/client/src/features/request-flow/components/request-picker-boundary.tsx` exporting `RequestPickerBoundary` that wraps its children in `<Suspense fallback={<RequestPickerSkeleton />}><ErrorBoundary fallback={<RequestPickerError onRetry={...} />}>{children}</ErrorBoundary></Suspense>`. Reuse the existing `ErrorBoundary` component used by [apps/client/src/features/notifications/settings/notifications-settings-page.tsx](../apps/client/src/features/notifications/settings/notifications-settings-page.tsx). Skeleton renders 2 placeholder rows; error fallback renders "Couldn't load servers — retry" with a click handler that calls `queryClient.resetQueries({ queryKey: requestFlow.targets(mediaType) })`. | | |
| TASK-037 | Rewrite `apps/client/src/features/request-flow/components/request-picker.tsx` to drop the `services` and `userRole` props. Inside the component, call `useRequestTargets(kind)` and render `targets`. Profile selector renders only when the picked target's `exposesProfiles && profiles.length > 0` (same gate at the existing line 82). Empty `targets` shows a "No request services configured" message. | | |
| TASK-038 | Rewrite `apps/client/src/features/request-flow/components/movie-request-action.tsx`: replace the `onSubmit?.(payload); setLocalStatus(...)` block with `useCreateRequest()` + `await create.mutateAsync(payload)`. Only flip status to `pending` after the mutation resolves. On error, do not flip status; let `toastFromError` show the toast. Mount the picker through `<RequestPickerBoundary>`. The `onSubmit` prop remains accepted but only called for tests/storybook (no production mutation runs through it). | | |
| TASK-039 | Rewrite `apps/client/src/features/request-flow/components/requestable-seasons.tsx` and `season-request-action.tsx` to use `useCreateRequest`. For per-season submit, send `seasons: [n]`; for bulk submit, send a single request with all selected season numbers in one `seasons: number[]`. Keep `onSeasonSubmit` / `onBulkSubmit` props for tests but do not gate production behavior on them. | | |
| TASK-040 | In the media-detail page (search for the route or component that renders the request-flow popovers — likely `apps/client/src/features/media-detail/` or `routes/media/...`), add `queryClient.prefetchQuery({ queryKey: requestFlow.targets(media.type), queryFn: () => requestsApi.targets({ mediaType: media.type }), staleTime: 5 * 60_000 })` at route load time. Use the React Query client provider's `useQueryClient()` if a loader is unavailable. | | |
| TASK-041 | Add client tests under `apps/client/src/features/request-flow/__tests__/`: `movie-request-action.test.tsx` (success → status flip + toast; mocked 502 → no flip + destructive toast; 400 → "invalid input" toast), `requestable-seasons.test.tsx` (single submit posts `seasons:[2]`; bulk submit posts one request with `seasons:[1,2,3]`; failure leaves all seasons untouched), `request-picker.test.tsx` (warm cache → no loading state, empty `targets` → empty state copy, profile selector hidden when `exposesProfiles === false`). Mock `requestsApi` via MSW or a test-only fetch shim — match the existing client test setup. | | |
| TASK-042 | Add `apps/client/src/features/request-flow/__tests__/issue-216-no-mutation.test.tsx`: mounts `MovieRequestAction`, simulates a submit, asserts `useCreateRequest`'s `mutateAsync` is called with the expected payload. This is the explicit regression for issue #216 per memory #17. | | |
| TASK-043 | Run `vp test apps/client` and `vp check`. Commit Phase 6. | | |

### Implementation Phase 7 — Changesets, final verification, and PR

- GOAL-007: Add Changesets entries, run the full verification suite, and prepare the PR.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-044 | Create `.changeset/request-flow-client.md` with frontmatter `"@ent-mcp/client": minor` and body "Request submissions now hit the server, with quality-profile choices loaded from the configured request services." | | |
| TASK-045 | Create `.changeset/request-flow-server.md` with frontmatter `"@ent-mcp/server": minor` and body "Wired the request-submission API and added a target-listing endpoint that aggregates configured request services." | | |
| TASK-046 | Create `.changeset/request-flow-plugin-sdk.md` with frontmatter `"@ent-mcp/plugin-sdk": minor` and body "Added a list-targets capability so request plugins can advertise their servers and quality profiles." | | |
| TASK-047 | Create `.changeset/request-flow-plugin-seerr.md` with frontmatter `"@ent-mcp/plugin-seerr": minor` and body "Surfaced configured Radarr and Sonarr servers and their quality profiles when submitting requests." | | |
| TASK-048 | Run `vp install` (in case lockfile drift), then `vp check`, then `vp test` from repo root. All must pass with zero failures. | | |
| TASK-049 | Open a PR titled `fix(request-flow): wire submissions to /api/requests (#216)` using the template at `.github/PULL_REQUEST_TEMPLATE/pull_request_template.md`. Include a Summary, Test plan, and `Closes #216` in the body. | | |

## 3. Alternatives

- **ALT-001**: Graft a `connectionId?: string` field onto `DispatchRequest` and branch in `dispatchSingle`. Rejected: `dispatchToConnection` already exists and exactly fits the use case; mutating the generic dispatcher would force every other strategy (`aggregate-per-kind`, `primary-with-enrichment`) to learn about `connectionId` for no benefit.
- **ALT-002**: Combined media id `"movie:123"` plus a comma-string `seasons` field. Rejected: combined ids are an internal helper convention; splitting `tmdbId` + `mediaType` matches the rest of the client domain and removes an id-parser branch from the request path.
- **ALT-003**: Always-200 responses with `{ success: bool, message? }` matching the plugin SDK shape. Rejected: standard REST status codes give React Query's `onError` the right semantics for free, and the global error middleware already renders structured `HttpError` payloads.
- **ALT-004**: Two-step Overseerr-style fetch (`GET /service/radarr` → list, then `GET /service/radarr/{id}` per click). Rejected: at media-manager scale the per-server detail payload is small, so one bulk fan-out delivered via React Query is simpler and keeps the picker snappy without extra round-trips.
- **ALT-005**: Add request-history typed schema in this PR. Rejected: there is no UI consumer of `GET /api/requests` yet; tightening the schema doubles the surface area without acceptance-criteria coverage.

## 4. Dependencies

- **DEP-001**: `dispatchToConnection`, `listEligibleConnections`, `loadConnectionById` from [apps/server/src/media/connection-targeted.ts](../apps/server/src/media/connection-targeted.ts) — already exported (loadConnectionById stays private).
- **DEP-002**: `MediaRequestV1` capability declaration from [packages/plugin-sdk/src/capabilities/media-request.ts](../packages/plugin-sdk/src/capabilities/media-request.ts) — extended in Phase 2.
- **DEP-003**: `HttpError`, `badRequest` factories from [apps/server/src/errors/http-errors.ts](../apps/server/src/errors/http-errors.ts) and `zValidator` from [apps/server/src/errors/validator.ts](../apps/server/src/errors/validator.ts) — used as-is.
- **DEP-004**: `requireSession`, `sessionUserId` from `apps/server/src/auth/middleware.ts` — used as-is.
- **DEP-005**: `useSuspenseQuery`, `useMutation`, `useQueryClient` from `@tanstack/react-query` (already a project dep, mirrored from `apps/client/src/features/notifications/settings/use-categories.ts`).
- **DEP-006**: Project ErrorBoundary primitive used by [apps/client/src/features/notifications/settings/notifications-settings-page.tsx](../apps/client/src/features/notifications/settings/notifications-settings-page.tsx) — reused for `RequestPickerBoundary`.
- **DEP-007**: Vite+ tooling — `vp check`, `vp test`, `vp install` per CLAUDE.md.

## 5. Files

- **FILE-001**: [packages/shared/src/media/schemas.ts](../packages/shared/src/media/schemas.ts) — replace `createMediaRequestSchema`; add response, target, and query schemas.
- **FILE-002**: [packages/shared/src/media/index.ts](../packages/shared/src/media/index.ts) — re-export new symbols.
- **FILE-003**: [packages/plugin-sdk/src/capabilities/media-request.ts](../packages/plugin-sdk/src/capabilities/media-request.ts) — add `listTargets`, extend `createRequest`.
- **FILE-004**: `packages/plugin-sdk/src/capabilities/__tests__/media-request.test.ts` — new schema-snapshot test file.
- **FILE-005**: [packages/plugins/seerr/src/capabilities/media-request.ts](../packages/plugins/seerr/src/capabilities/media-request.ts) — implement `listTargets`, extend `createRequest`.
- **FILE-006**: [packages/plugins/seerr/src/plugin.ts](../packages/plugins/seerr/src/plugin.ts) — verify capability spread includes `listTargets`.
- **FILE-007**: [packages/plugins/seerr/__tests__/media-request.test.ts](../packages/plugins/seerr/__tests__/media-request.test.ts) — extend with new method coverage.
- **FILE-008**: `apps/server/src/media/service-id.ts` — new codec module (`encodeServiceId`, `decodeServiceId`, `TARGET_ID_RE`).
- **FILE-009**: [apps/server/src/media/service.ts](../apps/server/src/media/service.ts) — rewrite `requestDownload`, add `listRequestTargets`.
- **FILE-010**: [apps/server/src/api/procedures/requests.ts](../apps/server/src/api/procedures/requests.ts) — full rewrite per design.
- **FILE-011**: `apps/server/src/api/procedures/__tests__/requests.test.ts` — new procedure-level integration tests.
- **FILE-012**: `apps/server/src/media/__tests__/service.request-flow.test.ts` — new MediaService-level unit tests.
- **FILE-013**: `apps/client/src/features/request-flow/api/query-keys.ts` — new.
- **FILE-014**: `apps/client/src/features/request-flow/api/errors.ts` — new.
- **FILE-015**: `apps/client/src/features/request-flow/api/client.ts` — new.
- **FILE-016**: `apps/client/src/features/request-flow/api/use-request-targets.ts` — new.
- **FILE-017**: `apps/client/src/features/request-flow/api/use-create-request.ts` — new.
- **FILE-018**: [apps/client/src/features/request-flow/index.ts](../apps/client/src/features/request-flow/index.ts) — re-export hooks.
- **FILE-019**: [apps/client/src/features/request-flow/lib/types.ts](../apps/client/src/features/request-flow/lib/types.ts) — delete `RequestPayload`, `RequestService`, `RequestProfile`, `RequestDestination`, `ServiceGlyph`, `UserRole`.
- **FILE-020**: `apps/client/src/features/request-flow/lib/mock-services.ts` — **delete**.
- **FILE-021**: [apps/client/src/features/request-flow/lib/destination-helpers.ts](../apps/client/src/features/request-flow/lib/destination-helpers.ts), [lib/request-helpers.ts](../apps/client/src/features/request-flow/lib/request-helpers.ts) — update or delete obsolete helpers.
- **FILE-022**: `apps/client/src/features/request-flow/components/request-picker-boundary.tsx` — new wrapper.
- **FILE-023**: [apps/client/src/features/request-flow/components/request-picker.tsx](../apps/client/src/features/request-flow/components/request-picker.tsx) — drop props, read from hook.
- **FILE-024**: [apps/client/src/features/request-flow/components/movie-request-action.tsx](../apps/client/src/features/request-flow/components/movie-request-action.tsx) — wire `useCreateRequest`, mount boundary.
- **FILE-025**: [apps/client/src/features/request-flow/components/requestable-seasons.tsx](../apps/client/src/features/request-flow/components/requestable-seasons.tsx), [components/season-request-action.tsx](../apps/client/src/features/request-flow/components/season-request-action.tsx) — wire mutation, support bulk + single submit.
- **FILE-026**: Media-detail route or page component (TBD by repo grep) — add `prefetchQuery` for targets at mount.
- **FILE-027**: `apps/client/src/features/request-flow/__tests__/movie-request-action.test.tsx` — new.
- **FILE-028**: `apps/client/src/features/request-flow/__tests__/requestable-seasons.test.tsx` — new.
- **FILE-029**: `apps/client/src/features/request-flow/__tests__/request-picker.test.tsx` — new.
- **FILE-030**: `apps/client/src/features/request-flow/__tests__/issue-216-no-mutation.test.tsx` — new regression test.
- **FILE-031**: `.changeset/request-flow-client.md`, `.changeset/request-flow-server.md`, `.changeset/request-flow-plugin-sdk.md`, `.changeset/request-flow-plugin-seerr.md` — four new changeset files.

## 6. Testing

- **TEST-001**: Plugin SDK schema snapshot — `MediaRequestV1.methods.listTargets` accepts `{ type: "movie" }`, rejects targets with illegal `targetId`, and `createRequest.input` accepts the new optional fields. (TASK-009)
- **TEST-002**: Seerr plugin `listTargets` for movies fans `/service/radarr` then `/service/radarr/{id}` and yields the expected mapped shape. (TASK-014a)
- **TEST-003**: Seerr plugin `listTargets` for tv hits `/service/sonarr` and `/service/sonarr/{id}`. (TASK-014b)
- **TEST-004**: Seerr plugin `createRequest` with `targetId: "2"` + `profileId: "7"` POSTs `{ mediaType, mediaId, serverId: 2, profiles: { profileId: 7 } }`. (TASK-014c)
- **TEST-005**: Seerr plugin `createRequest` without `targetId`/`profileId` posts the existing body unchanged. (TASK-014d)
- **TEST-006**: `MediaService.listRequestTargets` aggregates across connections. (TASK-023)
- **TEST-007**: `MediaService.listRequestTargets` skips a broken connection's failure with a warning. (TASK-023)
- **TEST-008**: `MediaService.listRequestTargets` drops targets whose `targetId` fails `TARGET_ID_RE`. (TASK-023)
- **TEST-009**: `MediaService.requestDownload` decodes `serviceId` and calls `dispatchToConnection` with the correct `connectionId` + decoded `targetId`; passes `seasons` only when `mediaType === "tv"`. (TASK-023)
- **TEST-010**: `MediaService.requestDownload` maps `PluginCallError("mcp.target_not_found")` → 404, `plugin.input_invalid|upstream_error|timeout` → 502, others → 500. (TASK-023)
- **TEST-011**: GET `/api/requests` returns `{ items }` from `MediaService.getRequests`. (TASK-024)
- **TEST-012**: GET `/api/requests/targets?mediaType=movie` returns aggregated targets. (TASK-024)
- **TEST-013**: GET `/api/requests/targets` returns `{ targets: [] }` when every connection's `listTargets` fails. (TASK-024)
- **TEST-014**: POST `/api/requests` happy path → `{ requestId }`. (TASK-024)
- **TEST-015**: POST `/api/requests` 400 on malformed body or malformed `serviceId`, 404 on unknown service, 422 when target requires profile and none provided, 502 on provider failure. (TASK-024)
- **TEST-016**: POST `/api/requests` with `mediaType: "movie"` + `seasons: [1]` succeeds, seasons silently dropped, warning logged. (TASK-024)
- **TEST-017**: `MovieRequestAction` submit success flips status to `pending` and shows a toast. (TASK-041)
- **TEST-018**: `MovieRequestAction` submit failure (mocked 502) leaves status `available` and shows a destructive toast. (TASK-041)
- **TEST-019**: `MovieRequestAction` 400 validation surfaces "invalid input" copy. (TASK-041)
- **TEST-020**: `RequestableSeasons` single-season submit sends `seasons: [2]`. (TASK-041)
- **TEST-021**: `RequestableSeasons` bulk submit sends one request with `seasons: [1,2,3]`. (TASK-041)
- **TEST-022**: `RequestableSeasons` failure leaves every season's status untouched. (TASK-041)
- **TEST-023**: `RequestPicker` with warm cache shows targets immediately (no loading state). (TASK-041)
- **TEST-024**: `RequestPicker` with empty `targets` array shows the empty-state copy. (TASK-041)
- **TEST-025**: `RequestPicker` profile selector is hidden when `exposesProfiles === false`. (TASK-041)
- **TEST-026**: Issue #216 regression — `MovieRequestAction` submit invokes `useCreateRequest`'s `mutateAsync` with the expected payload. (TASK-042)
- **TEST-027**: Full verification — `vp check && vp test` passes with zero failures. (TASK-048)

## 7. Risks & Assumptions

- **RISK-001**: The current `apps/server/src/api/index.ts` (or equivalent) may not yet mount `requestsApp`. TASK-022 explicitly verifies and adds the mount; if mounting changes upstream during this work, the route may regress to a 404. Mitigation: TEST-011 / TEST-014 cover the mount end-to-end.
- **RISK-002**: The Overseerr API surface `/api/v1/service/radarr/{id}` may differ across Overseerr/Jellyseerr versions; profile field names vary (`activeProfileId` vs `defaultProfileId`). Mitigation: Seerr plugin defensively reads with optional chaining and falls back to `null`; integration tests assert the mapped output, not the upstream payload.
- **RISK-003**: `useSuspenseQuery` inside a Popover can cause the picker to unmount and remount mid-interaction if React Query refetches under the hood. Mitigation: `staleTime: 5 * 60_000` plus the deliberate omission of `invalidate(requestFlow.targets)` in `useCreateRequest`'s `onSuccess` (per design). TEST-023 covers the warm-cache case.
- **RISK-004**: Existing seerr tests at `packages/plugins/seerr/__tests__/media-request.test.ts:67-89` assert the old `createRequest` body shape; extending input may break the snapshot. Mitigation: TASK-014 explicitly updates those expectations.
- **RISK-005**: The media-detail route's exact location (TASK-040) is not yet pinned in the spec. Mitigation: `grep -rn "media-detail\\|media/details" apps/client/src/routes apps/client/src/features` to locate; if no loader exists, run `prefetchQuery` from the page component's first render via `useEffect(() => { ... }, [media.type])`.
- **ASSUMPTION-001**: Only the seerr plugin currently implements `mediaRequest@v1`. `grep -rn "mediaRequest" packages/plugins/` confirmed this at design time; if a new plugin lands during implementation, TASK-007's `optional: true` flag keeps it compiling, but TASK-011-equivalent work for that plugin is out of scope.
- **ASSUMPTION-002**: The repo's existing fetch wrapper exposes structured error parsing (status code + JSON body) so `requestsApi.create` can construct a `RequestError` cleanly. If not, TASK-028 includes adding minimal error parsing inline.
- **ASSUMPTION-003**: `requireSession` middleware sets `c.var.userId` (consumed by `sessionUserId(c)`); confirmed by sibling procedures `search.ts:30` and `discover.ts:22`.
- **ASSUMPTION-004**: Pre-stable rule (memory #20) covers the breaking change to `MediaService.requestDownload`'s signature and `createMediaRequestSchema`'s shape — no compat shim is required.

## 8. Related Specifications / Further Reading

- Design doc: [docs/specs/2026-05-08-request-flow-api-wiring-design.md](../docs/specs/2026-05-08-request-flow-api-wiring-design.md)
- Issue: [#216](https://github.com/electather/media-manager/issues/216)
- Capability runtime: [apps/server/src/media/connection-targeted.ts](../apps/server/src/media/connection-targeted.ts)
- Procedure pattern reference: [apps/server/src/api/procedures/search.ts](../apps/server/src/api/procedures/search.ts), [apps/server/src/api/procedures/discover.ts](../apps/server/src/api/procedures/discover.ts)
- Suspense pattern reference: [apps/client/src/features/notifications/settings/notifications-settings-page.tsx](../apps/client/src/features/notifications/settings/notifications-settings-page.tsx)
- Project conventions: [CLAUDE.md](../CLAUDE.md)
- Overseerr API docs: <https://api-docs.overseerr.dev/>
