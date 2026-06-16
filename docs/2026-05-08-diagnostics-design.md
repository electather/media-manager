# Diagnostics — Errors & Performance

**Status:** Draft
**Date:** 2026-05-08
**Author:** Omid Astaraki
**Supersedes:** `docs/2026-04-19-error-management-design.md`
**Companions:** `2026-04-19-plugin-architecture-design.md`, `2026-04-19-frontend-connections-design.md`

## §Sum

Self-host diag svc. 2 record kinds: `error_records` ∧ `perf_records`. Shared: req-id corr, scrubber, retention sweep, sink iface, admin viewer. Module @ `apps/server/src/diagnostics/`. Dev-debug only. ⊥ analytics, ⊥ APM, ⊥ tracing spans.

## §G Goals

- G1: ∀ **unintended** err (FE | BE | plugin | cron) → captured. ⊥ ∀ HTTP non-2xx — 4xx user-input intentionally excluded (§Cap.E).
- G2: ∀ HTTP RPC handler → perf row (route, method, status, dur_ms).
- G3: ∀ plugin sandbox invoke → perf row (pluginId, method, dur_ms).
- G4: req-id chains err ↔ perf across surfaces.
- G5: codes registry → i18n no-migration.
- G6: admin viewer — search + filter + percentiles + chain.
- G7: pluggable `DiagnosticSink` → opt-in Sentry/GlitchTip/OTel adapter.
- G8: param route keys (no path-param cardinality blow).
- G9: err retention ≠ perf retention (perf hi-vol → shorter default).

## §¬G Non-Goals

⊥ DB query timing (v2).
⊥ FE Web Vitals (v2).
⊥ distributed traces / spans / waterfall.
⊥ APM, flamegraphs.
⊥ sampling (capture-all @ self-host).
⊥ alerting on perf regression.
⊥ session replay, breadcrumbs.
⊥ user-facing reports beyond toast + code.
⊥ product analytics, funnels.

## §Cap Capture Surfaces

### §Cap.E Errors

3 pts: FE, BE, plugin runtime. Severity model unchanged (§Sev).

| surface | trigger                              | action                                                                |
| ------- | ------------------------------------ | --------------------------------------------------------------------- |
| FE      | React error boundary (root + routes) | catch render → POST `/api/diagnostics/errors` → fallback UI w/ req-id |
| FE      | `window.error`, `unhandledrejection` | global handlers capture outside React tree                            |
| FE      | `reportError(err, sev, ctx?, code?)` | explicit capture                                                      |
| FE      | RPC non-2xx                          | `warning` FE-only; BE holds authoritative                             |
| BE      | RPC mw 5xx throw                     | `error`, req-id stamp, rethrow                                        |
| BE      | RPC mw 4xx handler bug               | `error`                                                               |
| BE      | RPC mw 4xx user input                | ⊥ captured (auth denied / 404 / bad input)                            |
| BE      | `PluginCallError` w/ `info` code     | ⊥ captured; → 422 structured body; ⊥ notification (§PluginErr)        |
| Plugin  | sandbox throw                        | `error`, src+pluginId+stack+req-id, mark conn errored                 |
| Plugin  | output Zod fail                      | `warning`, host → empty results                                       |
| Plugin  | OOM \| timeout                       | `error` w/ cause                                                      |
| Cron    | job handler throw                    | wrapper: log job + exception                                          |
| Cron    | plugin manifest parse \| schema-validate ⊥ at startup | log + skip row, capture `cron.manifest_invalid`; siblings still register |

### §Cap.P Perf

2 dims v1: HTTP req timing, plugin invoke timing.

| surface   | trigger                | action                                                                                                 |
| --------- | ---------------------- | ------------------------------------------------------------------------------------------------------ |
| BE HTTP   | hono mw wrap ∀ handler | `t0 = now()`; await; finally `capturePerf({kind:"http", route, method, status, durationMs: now()-t0})` |
| BE Plugin | runtime invoke wrap    | `t0 = now()`; invoke; finally `capturePerf({kind:"plugin", pluginId, method, durationMs})`             |

`route` = parameterized (`/api/connections/:id`), ⊥ raw URL. Source: hono matched route pattern.

### §Cap.P.Skip — exclusions

- streaming/SSE endpoints (no useful single duration).
- `/api/diagnostics/*` itself (avoid recursion).
- unmatched routes (`!c.req.routePath`) — covers static / 404 / pre-router middleware throws.

## §Sev Severity (errors)

V1 `error` shown default. V2 `warning` toggle off. V3 `info` ⊥ shown (drowns).

`info` ≠ logs. User-input only. Severity lives on **code**, ⊥ callsite. Registry @ `packages/shared/src/diagnostics/codes.ts`.

```ts
HOST_ERROR_CODES = {
  "plugin.input_invalid": { severity: "info" },
  "plugin.bad_credentials": { severity: "info" },
  "plugin.upstream_error": { severity: "error" },
  "plugin.output_invalid": { severity: "warning" },
  "media.no_connection": { severity: "info" },   // user has no plugin connected — expected
  "artwork.bad_input": { severity: "info" },
  "artwork.unsupported_id_combo": { severity: "info" },
  "artwork.internal": { severity: "error" },
  "cron.job_failed": { severity: "error" },
  "cron.manifest_invalid": { severity: "error" },
  // ...
} as const satisfies Record<string, ErrorCodeSpec>;
```

`captureError` effective sev: 1) caller param wins; 2) registry; 3) unknown → `error`.

## §PluginErr PluginCallError boundary contract

`PluginCallError` (thrown by `single` ∧ `aggregate_per_kind` strategies) ⊥ treated as generic 500. `errorHandler` has explicit branch before fallback else:

```
errorHandler(err, c):
  | err instanceof HttpError:            // unchanged
    ...
  | err instanceof PluginCallError:      // NEW — B fix
    sev = severityFor(err.code)          // registry; unknown → "error"
    sev ≠ "info" → captureError(err, {severity:sev, source:"backend", code:err.code,
                                      pluginId:err.pluginId, httpStatus:422, ...})
    → c.json({code:err.code, devMessage:err.message, requestId}, 422)
  | else:                                // unchanged — http.internal_error
    ...
```

∀ `PluginCallError` w/ `info` severity (e.g. `media.no_connection`, `plugin.bad_credentials`, `plugin.token_expired`, `connection.not_found`) → ⊥ captureError → ⊥ notification → ⊥ log entry. Client receives structured 422 w/ code preserved.

`warning`/`error` codes → captureError w/ registry severity (⊥ `http.internal_error` override).

Other `info`-severity codes that bubble through different call sites need C-style fixes at their own service boundary. Known `info` codes from registry: `plugin.input_invalid`, `plugin.bad_credentials`, `plugin.token_expired`, `plugin.disabled`, `connection.test_failed`, `connection.not_found`, `connection.verify_failed`, `media.no_connection`.

### Service-layer fixes (C — stop throw escaping) — `media.no_connection` initial set

Prevent `PluginCallError("media.no_connection")` from reaching boundary for known call sites:

```
// media/errors.ts — mapRequestPluginError addition
media.no_connection → HttpError(422, "media.no_connection", err.message)

// media/strategies/aggregate-per-kind.ts — invokeProvider, no-conn case
conn = pickSingleConnection(userId, pluginId)
conn ⊥ → log.debug("no_connection", pluginId); return          // skip provider, ⊥ throw

// media/service.ts — getRequests()
try: dispatchSingle(...)
catch PluginCallError e where e.code=="media.no_connection": return []
```

V: `cancelRequest` already uses `mapRequestPluginError` → picks up mapping automatically after fix.

### Invariants

V4: ∀ `PluginCallError` w/ registry `info` severity → ⊥ captureError ∧ ⊥ notification.
V5: ∀ `PluginCallError` reaching `errorHandler` → 422 (⊥ 500), original code preserved in body.
V6: `aggregate_per_kind` missing-conn provider → skip (partial result), ⊥ throw.
V7: service methods swallowing expected plugin absence → catch at service boundary; ⊥ naked `PluginCallError` reaches HTTP boundary.

## §Corr Request-ID

∀ record (err ∧ perf) tagged `requestId` UUID.

| surface | gen                                                                                                                                                                               |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FE      | **per RPC call** (fresh UUID); page-load also gens one for boundary/global handlers. Sent as `X-Request-Id` header on ∀ outbound RPC — header only; body field accepted for forwards-compat but server uses ALS value. |
| BE      | read header → validate `^[0-9a-zA-Z_-]{1,64}$` (gen on absent **or** invalid) → AsyncLocalStorage → plugin runtime                                                                 |
| Plugin  | tag `ctx.log`, stamp record                                                                                                                                                       |
| Cron    | gen @ job start                                                                                                                                                                   |

User → toast/boundary → `Ref: 7f3a2b1c`. Admin search by req-id → chain visible.

OTel bridge later: `requestId → traceId` trivial.

## §i18n Translation (errors only)

Wire fmt:

```ts
interface UserFacingError {
  code: string; // "plugin.timeout"
  params?: Record<string, string | number>; // template interp
  devMessage: string; // EN; logs/viewer only
  cause?: unknown; // viewer only
  requestId?: string;
  details?: Record<string, unknown>; // code-specific structured payload (e.g. `errors[]` for `media.providers_failed`, `candidates` for `mcp.ambiguous_target`)
}
```

Code namespace: `<domain>.<verb>` host; `plugin.<id>.<code>` plugin-emit. Host-emitted plugin codes (`plugin.timeout`, `plugin.output_invalid`) ⊥ namespaced — host owns them.

i18next file `locales/<lang>/errors.json`:

```json
{
  "connection.test_failed": "Could not connect to {{pluginName}}: {{reason}}",
  "plugin.timeout": "The {{pluginName}} plugin took too long to respond."
}
```

```ts
displayError = (e: UserFacingError) =>
  t(`errors:${e.code}`, { ...e.params, defaultValue: e.devMessage });
```

Missing translation → `devMessage`. Plugin code w/o host translation → `manifest.errorCodes[code]` → `devMessage`. Localization ⊥ block ship.

Discipline: ⊥ user-facing err via string concat. Lint flags concat-to-toast.

**Status v1**: i18n infra deferred → §Q. Display fall-back = `devMessage` raw.

## §DM Data Model

### §DM.E `error_records` (unchanged from prev doc, + `resolved_stack` per §Maps)

```
error_records
├── id              text PK              cuid2
├── request_id      text NOT NULL
├── severity        text NOT NULL        "error"|"warning"|"info"
├── source          text NOT NULL        "frontend"|"backend"|"plugin"|"cron"
├── code            text                 nullable for unhandled
├── dev_message     text NOT NULL       free-text scrubbed (§DM.Ctx)
├── stack           text                 free-text scrubbed (§DM.Ctx)
├── resolved_stack  text                 §Maps — minified frames translated to original source; null when no map matched
├── user_id         text FK→user.id      nullable
├── plugin_id       text FK→plugins.id   nullable
├── connection_id   text FK→service_connections.id  nullable
├── route           text                 RPC proc | FE param route (TanStack pattern, e.g. `/movie/$id`); param-key discipline same as perf (§G8) — ⊥ raw URL.
├── http_status     int                  BE only
├── context         text                 JSON scrubbed
├── created_at      int NOT NULL
INDEX(created_at DESC)
INDEX(request_id)
INDEX(plugin_id, created_at DESC)
INDEX(severity, created_at DESC)
```

### §DM.P `perf_records` (new)

```
perf_records
├── id              text PK              cuid2
├── request_id      text NOT NULL
├── kind            text NOT NULL        "http"|"plugin"
├── duration_ms     int NOT NULL
├── route           text                 http: param path; plugin: method name
├── method          text                 http verb (GET/POST/...); plugin: NULL
├── status          int                  http only; NULL plugin
├── plugin_id       text FK→plugins.id   plugin only
├── user_id         text FK→user.id      nullable
├── created_at      int NOT NULL
INDEX(created_at DESC)
INDEX(kind, route, created_at DESC)        -- p95 by route
INDEX(kind, plugin_id, created_at DESC)    -- p95 by plugin
INDEX(request_id)                          -- chain w/ errors
```

`route` = param key. Examples: `/api/connections/:id`, `/api/plugins/:pluginId/run`. Plugin: `connections.test`, `media.search`, etc.

### §DM.Cfg `app_config` extension

```
app_config (existing row)
├── error_retention_days   int   default 30
├── perf_retention_days    int   default 7      ← new
```

### §DM.Ctx Context blob + free-text scrubbing (errors only)

**Context blob.** JSON + scrub on write. Allowed: RPC input shape (names+types ⊥ values), handler fields worked, plugin method, HTTP status, UA. Scrubbed: ∀ value ∈ credentials | `user_config` | `global_config`; key match `password|passwd|pwd|api_key|apikey|api-key|token|authorization|bearer|secret|credentials|cookie|private_key`; `Set-Cookie|Authorization` headers.

**Free-text fields.** `dev_message` ∧ `stack` ⊥ structured → key-based scrub ⊥ apply. `scrubText` runs on write covering:

- `Bearer <token>` → `Bearer [REDACTED]` (auth headers leaked into error strings).
- URL query params matching `SENSITIVE_KEY_PATTERNS` substring → `name=[REDACTED]` (covers OAuth `access_token`/`refresh_token`/`id_token`, `client_secret`, bare `token`/`api_key`/`password`/`cookie`).
- JWT-shaped strings (`eyJ…` three base64url segments) → `[JWT_REDACTED]`.

Scrubber @ `apps/server/src/diagnostics/scrubber.ts` — sole owner of `SENSITIVE_KEY_PATTERNS`, `scrub`, `scrubText`, `serializeContext`. Explicit patterns; additions reviewed.

**Credentials ⊥ enter diag layer.** Sandbox throws ⊥ pull `ctx`. RPC ⊥ auto-capture bodies. Arch guarantee, ⊥ scrubber as safety. Perf records → no context blob (no risk surface).

## §Cap-API Capture API

### §Cap-API.BE Backend

```ts
// apps/server/src/diagnostics/capture.ts

captureError(err, {
  severity?: "error"|"warning"|"info"   // optional → derived from code
  source: "backend"|"plugin"|"cron"
  code?, route?, userId?, pluginId?, connectionId?
  context?: Record<string, unknown>      // scrubbed on write
}): Promise<string>                       // err record id

capturePerf({
  kind: "http"|"plugin"
  durationMs: number
  route?: string                           // param path | plugin method
  method?: string                          // http verb
  status?: number                          // http
  pluginId?: string                        // plugin
  userId?: string
}): Promise<void>                          // fire-forget; err in sink ⊥ block
```

Both read `requestId` from AsyncLocalStorage. Both fan-out via `Promise.allSettled` to ∀ sink. Unknown sink failure → swallow (telemetry ⊥ break app).

### §Cap-API.FE Frontend

```ts
// apps/client/src/shared/lib/diagnostics/report.ts

reportError(err, severity, context?, code?): Promise<void>
// POST /api/diagnostics/errors w/ header `X-Request-Id` (canonical source).
// body.requestId accepted-but-ignored for forwards-compat; BE always uses the ALS
// requestId derived from the header (or freshly minted if absent) — prevents a
// client from spoofing the correlation id on stored records.
// silent drop on fail
```

V1 ⊥ FE perf reporting. V2 = Web Vitals.

### §Maps Hidden-sourcemap stack resolution (frontend stacks)

Production FE stacks are minified and useless as-is. Resolution pipeline:

- **Build**: client `vite.config.ts` sets `build.sourcemap = "hidden"` — `.map` files emit next to bundles but no `//# sourceMappingURL` comment is added, so browsers never fetch them. `"hidden"` only strips the comment; the maps still land in `dist/`, which both deploy targets serve verbatim (Hono `serveStatic` root + Cloudflare `[assets]` directory). So the `extract-hidden-sourcemaps` build plugin moves every `.map` out of `dist/` into a sibling `dist-sourcemaps/` after the build, and the server refuses any `*.map` request as defence in depth. Maps are NOT deployed publicly.
- **Ingest**: `POST /api/diagnostics/sourcemaps` (admin, `admin:server` — same gate as the rest of `/admin/diagnostics`) accepts `{ buildId, fileName, map }` per `.map` file (CI uploads from `dist-sourcemaps/` post-build). `fileName` is constrained to a JS bundle basename. Stored in `sourcemaps` table (`id, build_id, file_name, content, created_at`; UNIQUE(build_id, file_name) upsert; private — never served).
- **Resolution**: on `POST /api/diagnostics/errors`, `resolveStackTrace(stack, buildId?)` (`apps/server/src/diagnostics/sourcemaps.ts`) parses each frame's `file:line:col`, matches the bundle basename (Vite content-hashes names, so basename ⊥ build collisions) against stored maps — scoped to `buildId` when the report carries one (optional `buildId` on `errorReportSchema`) — and translates positions via `@jridgewell/trace-mapping`. Parsed `TraceMap`s sit in an LRU (incl. negative entries; the just-uploaded `(buildId, fileName)` keys are evicted on upload).
- **Storage**: raw stack stays in `stack`; the translated stack lands in `resolved_stack` (both scrubbed §DM.Ctx). Unresolvable frames are kept verbatim; if zero frames resolve the column is null.
- **Retention**: the nightly sweep (§Retn) bounds `sourcemaps` by build count, not age — it keeps maps for the 50 most-recently-active `build_id`s (newest `created_at` per build) and deletes the rest. A long-lived deploy keeps its maps however old it is, so the current build's maps can never be pruned out from under it.

Resolution failure never blocks ingest (catch → null).

### §Cap-API.MW Middleware (perf)

```ts
// apps/server/src/diagnostics/middleware.ts

httpPerfMiddleware = async (c, next) => {
  const t0 = Date.now();
  try {
    await next();
  } finally {
    const route = c.req.routePath; // hono ≥ 4.x; matched pattern e.g. "/api/connections/:id"
    if (!route) return; // unmatched → skip (covers static, 404, pre-router throws)
    if (route.startsWith("/api/diagnostics")) return; // recursion guard
    if (isStreaming(c.res)) return; // SSE / streaming
    capturePerf({
      kind: "http",
      route,
      method: c.req.method,
      status: c.res.status,
      durationMs: Date.now() - t0,
      userId: getUserId(c),
    });
  }
};
```

Plugin runtime: existing invoke wrap → add `t0`/`durationMs` finally block.

## §Sink Pluggable Sinks

```ts
interface DiagnosticSink {
  captureError?(rec: ErrorRecord): Promise<void>;
  capturePerf?(rec: PerfRecord): Promise<void>;
}
```

Both methods optional → sink can subscribe to one kind. Built-in:

| sink                    | err | perf | note                                                |
| ----------------------- | --- | ---- | --------------------------------------------------- |
| `DatabaseSink`          | ✓   | ✓    | writes both tables                                  |
| `NotificationErrorSink` | ✓   | —    | emit `system.error` notification @ severity=`error` |

Future (v2 adapters): Sentry, GlitchTip, OTel collector. Ext-point only v1.

```
captureError(rec)         capturePerf(rec)
  ↓                          ↓
sinks                       sinks
 .filter(s => s.captureError) .filter(s => s.capturePerf)
 .map(s => s.captureError(rec)) .map(s => s.capturePerf(rec))
  → Promise.allSettled        → Promise.allSettled
```

Two dispatch sites — one per record kind. Sink missing the matching method = silently skipped.

## §Retn Retention

Nightly cron `host.diagnostics.retention_sweep`:

```ts
sweep() {
  const now = Date.now()
  await db.delete(errorRecords).where(lt(createdAt, now - cfg.errorRetentionDays * 86400e3))
  await db.delete(perfRecords ).where(lt(createdAt, now - cfg.perfRetentionDays  * 86400e3))
  // Sourcemaps are bounded by build count, not age (§Maps Retention):
  // keep maps for the 50 most-recently-active build_ids, delete the rest.
  pruneSourcemaps()
}
```

Defaults: err=30d (clamp 7-365d), perf=7d (clamp 1-90d). Read once per sweep from `app_config`. Sourcemap prune uses a hardcoded N=50 builds — no `app_config` column.

## §Adm Admin Viewer — `/admin/diagnostics`

Permission: `admin:server`. Replaces `/admin/errors` (file `admin/logs.tsx` → `admin/diagnostics.tsx`).

### §Adm.Lay Layout

```
/admin/diagnostics
├── header: "Diagnostics"
├── tabs: [Errors] [Performance]
└── tab-content
```

### §Adm.E Errors tab

Unchanged from prev doc. Widget last-24h count + sparkline. Filters: severity, source, plugin, range, req-id, search. Table → right Sheet detail.

### §Adm.P Performance tab

Top widget: 4 stat cards (req/min, p50, p95, p99 — last 24h). Trend sparkline on req/min, p50, p95. p99 ships without a sparkline because the summary endpoint does not bucket a p99 hourly series; add server-side p99 buckets to enable it.

Filter bar: kind (http|plugin), route/method (autocomplete from distinct), plugin (dropdown), range (24h|7d|30d|custom), req-id (exact).

**Aggregate view** (default): rows = grouped by `(kind, route)` or `(kind, pluginId, method)`.

| col   | val                                          |
| ----- | -------------------------------------------- |
| route | `GET /api/connections/:id` \| `trakt.search` |
| count | n events in window                           |
| p50   | ms                                           |
| p95   | ms                                           |
| p99   | ms                                           |
| max   | ms                                           |
| last  | relative ts                                  |

Sort: p95 desc default. Click row → drill view.

**Drill view** (right Sheet):

- histogram durations (log buckets).
- top 50 slowest raw events (timestamp, dur, status, req-id link → chain to errors).
- linked error count w/ same req-id (correlated failures).

Aggregation impl: SQL window query, ⊥ pre-aggregated rollups v1.

```sql
-- p95 by route last 24h
SELECT kind, route,
       count(*) AS n,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) AS p50,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95,
       percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms) AS p99,
       max(duration_ms) AS max_ms,
       max(created_at)  AS last_at
FROM perf_records
WHERE created_at > :since
GROUP BY kind, route
ORDER BY p95 DESC
LIMIT 100
```

SQLite fallback: ⊥ `percentile_cont`. Use `ORDER BY duration_ms LIMIT 1 OFFSET (n*0.95)::int` per group via subquery or CTE. Or: pre-compute via lib at app layer (read all rows in window, calc in JS — fine @ self-host vol).

**v1 path** = JS-side calc, **bounded** read: max 50k rows per window. If `count(*) > 50k`, fall back to SQL `LIMIT/OFFSET` subquery per group instead of pulling rows. v2 = SQL window if even that bottlenecks.

### §Adm.NavSig

Sidebar `/admin/diagnostics` badge = err-count last hour. Red @ threshold (v1 = count only).

### §Adm.API Endpoints

Permission `admin:server` ∀:

```
GET    /admin/diagnostics/errors                  list + filters + pagination
GET    /admin/diagnostics/errors/summary          last-24h count + 24-bucket sparkline
GET    /admin/diagnostics/errors/:id              detail
GET    /admin/diagnostics/perf/aggregate          grouped p50/p95/p99 by route|plugin
GET    /admin/diagnostics/perf/list               raw events + filters + pagination
GET    /admin/diagnostics/perf/:id                detail
GET    /admin/diagnostics/perf/summary            last-24h req/min + percentiles + sparkline
GET    /admin/diagnostics/config                  read both retentions
PUT    /admin/diagnostics/config                  set both retentions (clamped)
POST   /api/diagnostics/errors                    FE error report (no admin perm; rate-limit)
POST   /api/diagnostics/sourcemaps                 hidden-map upload (admin:server; CI post-build)
```

HTTP error envelope: `{ code, devMessage, params?, details?, requestId }`. `details` carries code-specific structured payloads (e.g. `media.providers_failed` exposes per-provider `errors[]`); flat translation values live in `params`.

## §Mig Migration (rename + new)

Pre-stable → DB & API breaking changes acceptable. Steps:

1. **BE rename**: `apps/server/src/errors/*` → `apps/server/src/diagnostics/*`. Update imports.
2. **Shared rename**: `packages/shared/src/errors/*` → `packages/shared/src/diagnostics/*`. Subpath export `@nama/shared/diagnostics`.
3. **FE rename**: `apps/client/src/shared/lib/errors/*` → `apps/client/src/shared/lib/diagnostics/*`. Update imports (error-boundary, global-handlers).
4. **DB migration**: add `perf_records` table + indexes; add `app_config.perf_retention_days` col default 7. **`error_records` table NAME unchanged** — deliberate exception to rename pattern (table rename = needless migration churn; name only visible in SQL logs).
5. **Iface rename**: `ErrorSink` → `DiagnosticSink` w/ optional `captureError` ∧ `capturePerf`. `NotificationErrorSink` adapt (only `captureError`).
6. **API rename**: `/admin/errors/*` → `/admin/diagnostics/*`. `/api/errors` → `/api/diagnostics/errors`. FE caller updated.
7. **Route file rename**: `apps/client/src/routes/_authenticated/_settings/admin/logs.tsx` → `admin/diagnostics.tsx`. Tab UI added.
8. **Cron rename**: `host.errors.retention_sweep` → `host.diagnostics.retention_sweep`. Sweep both tables.
9. **Add HTTP perf middleware**: register on hono root after request-context mw, before route handlers.
10. **Add plugin runtime perf**: extend invoke wrap to record duration.

⊥ shim, ⊥ deprecation. Single PR or stacked PRs OK.

## §T Testing

| test        | coverage                                                           |
| ----------- | ------------------------------------------------------------------ |
| Unit        | scrubber vs creds/tokens/nested. ∀ sensitive removed.              |
| Unit        | param route extraction (`/x/123` → `/x/:id` from hono match).      |
| Unit        | percentile calc js fallback (sorted slice).                        |
| Integration | RPC mw 5xx captured, expected 4xx user ⊥ captured.                 |
| Unit        | `PluginCallError("media.no_connection")` → 422, ⊥ captureError (V4,V5). **(planned — §PluginErr impl PR)** |
| Unit        | `PluginCallError` unknown code → `severity:"error"` → captureError + 422. **(planned)** |
| Unit        | `aggregate_per_kind` missing conn → provider skipped, result partial (V6). **(planned)** |
| Unit        | `mapRequestPluginError("media.no_connection")` → `HttpError(422)`. **(planned)** |
| Integration | HTTP perf mw writes row on success ∧ failure (still timed).        |
| Integration | HTTP perf mw skips streaming + `/api/diagnostics/*`.               |
| Integration | plugin runtime: throw → err record; success → perf record.         |
| Integration | `perf/aggregate` returns p50/p95/p99 sorted by p95 desc.           |
| Integration | retention sweep: insert range → run → verify deletions ∀ tables.   |
| E2E         | FE err → viewer Errors tab w/ req-id → Perf tab same req-id chain. |
| Unit        | `POST /api/diagnostics/errors` rejects msg > 2000, context > 20 keys, ctx str > 1000, nested ctx. |
| Unit        | `POST /api/diagnostics/errors` 11th rapid req → 429 + `Retry-After`; oversized body still 429 when bucket empty (mw before validator). |
| Unit        | `POST /api/diagnostics/errors` w/o session → 401 via `requireSession`. |

## §Q Open Questions / Deferred

| q                      | status | note                                                                            |
| ---------------------- | ------ | ------------------------------------------------------------------------------- |
| Alerting thresholds    | v2     | "errs/hour > baseline", "p95 regression". Deferred. v1 = count only.            |
| Error grouping         | v2     | Sentry-style "400× same" deferred. Fingerprint col later.                       |
| External sinks         | v2     | Iface v1; ⊥ concrete (DB+notify only). Sentry/GlitchTip/OTel adapter on demand. |
| Incident pages         | v2     | "We know" banner cross plugin breaks deferred. Conn card state OK v1.           |
| Rate limiting          | done   | Per-user token bucket (10 burst, ~10/min refill) on `POST /api/diagnostics/errors` w/ `Retry-After`. Mw runs before validator. Multi-replica shared store still v2. |
| DB query timing        | v2     | Drizzle wrapper. Defer until HTTP timing surfaces specific slow routes.         |
| FE Web Vitals          | v2     | LCP/INP/CLS via PerformanceObserver → POST `/api/diagnostics/perf`. Deferred.   |
| Sampling               | v2?    | v1 capture-all. Add reservoir sampling if perf vol > N/day.                     |
| Pre-aggregated rollups | v2?    | v1 = on-the-fly query. Hourly/daily rollup table if window queries slow.        |
| i18n shipping          | v2     | v1 fallback `devMessage`. Build `errors.json` + `displayError` v2.              |
| Lint rule concat-toast | v2     | Discipline (§i18n) currently review-only. Add oxlint rule v2.                   |
