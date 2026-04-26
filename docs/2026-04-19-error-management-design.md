# Error Management — Plugins & API Endpoints

**Status:** Draft  
**Date:** 2026-04-19  
**Author:** Omid Astaraki  
**Companions:** `2026-04-19-plugin-architecture-design.md`, `2026-04-19-frontend-connections-design.md`

## Summary

Capture → store errors across frontend, backend oRPC, plugin runtime. Self-hosted DB, correlated via request ID, structured codes → i18n. Admin viewer `/admin/errors` with search & request-ID chaining. Dev context ≠ user messages. Credentials ⊥ stored (by design).

Dev-debugging only. ⊥ product analytics.

## Goals

V1: ∀ error from frontend | backend | plugin sandbox → captured.
V2: ∀ user action → single request ID across surfaces.
V3: errors self-hosted; no external export default.
V4: error codes → i18n without migration.
V5: admin viewer → search, filter, request-ID chain.
V6: pluggable `ErrorSink` → forward to Sentry, GlitchTip.

## Non-Goals

⊥ product analytics, usage, funnels.
⊥ distributed tracing spans (request ID sufficient; timing later).
⊥ APM, perf metrics.
⊥ session replay, breadcrumbs.
⊥ user-facing error reports beyond toast + code.
⊥ alerting, paging (viewer trends shown; alerting deferred).

## Capture Surfaces

3 points: frontend, backend, plugin runtime. Each has own integration.

### Frontend

| trigger                                      | action                                                          |
| -------------------------------------------- | --------------------------------------------------------------- |
| React error boundary (root + routes)         | catch render → POST `/api/errors` → fallback UI with request ID |
| `window.error` & `unhandledrejection` events | catch outside React tree                                        |
| `reportError(err, severity, context?)`       | explicit capture (fetch failed but fallback OK)                 |
| oRPC non-2xx                                 | tag `warning` frontend-only; backend holds authoritative record |

### Backend

oRPC middleware wraps ∀ handler:

| response          | action                                                      |
| ----------------- | ----------------------------------------------------------- |
| `5xx` throw       | `error` severity, request ID stamp, rethrow                 |
| `4xx` handler bug | `error` (validation fail outgoing data, unexpected state)   |
| `4xx` user input  | ⊥ captured (auth denied, 404, bad input = product behavior) |

Cron failures: wrapper logs job + exception.

### Plugin Runtime

Via sandbox error path (§Plugin runtime):

| event             | severity                                                                        |
| ----------------- | ------------------------------------------------------------------------------- |
| throws in sandbox | `error`, record source + pluginId + stack + request ID, mark connection errored |
| output fails Zod  | `warning` (host → empty results, event recorded)                                |
| OOM \| timeout    | `error` with cause                                                              |

## Severity Model

V1: `error` = bug | infra failure. Shown by default.
V2: `warning` = recovered (bad output → fell back, pool rotated). Toggle off.
V3: `info` = user-input fail (bad URL, wrong password, 404, denied). ⊥ shown (drown signal). Toggle on when debugging.

`info` ≠ logs. User-input only.

### Severity Lives on Code, Not Callsite

∀ code → default severity in registry `server/src/errors/codes.ts`. Single source:

```ts
export const HOST_ERROR_CODES = {
  "plugin.input_invalid": { severity: "info" },
  "plugin.bad_credentials": { severity: "info" },
  "plugin.upstream_error": { severity: "error" },
  "plugin.output_invalid": { severity: "warning" },
  // ...
} as const satisfies Record<string, ErrorCodeSpec>;
```

Object shape (not flat record) → extensible: translation hints, HTTP status, category, echo request ID to user. ⊥ refactor ∀ consumer.

`captureError` effective severity:

1. Caller `severity` param → wins (recover → bump `error` to `warning`).
2. Else → code's registered severity.
3. Unknown → `error`. Over-capture > silent drop.

Decision "store at severity X" → one place. ⊥ ritual `severity: "error"` ∀ try/catch. Exception = diverge from registry.

## Correlation — Request ID

∀ error tagged `requestId` (UUID). Sources:

| surface  | generation                                                                                 |
| -------- | ------------------------------------------------------------------------------------------ |
| Frontend | once per page load or oRPC call, sent `X-Request-Id` header                                |
| Backend  | read header \| generate if absent, available via AsyncLocalStorage, pass to plugin runtime |
| Plugin   | tag `ctx.log`, stamp error record                                                          |
| Cron     | generate @ job start                                                                       |

User → error toast/boundary/card → display `Ref: 7f3a2b1c`. Admin viewer search by request ID → user copy-paste → admin finds chain.

OTel bridge: `requestId → traceId` trivial. ⊥ refactor when sink added.

## Translation — Error Codes & Messages

User & dev messages separate. Constraint: translate ⊥ painful migration.

### Wire Format

∀ oRPC error | plugin → host conforms:

```ts
interface UserFacingError {
  code: string; // stable, namespaced, snake_case
  params?: Record<string, string | number>; // interpolation values
  devMessage: string; // English, logs/viewer only
  cause?: unknown; // viewer only
  requestId?: string;
}
```

`code` namespaced:

- Host: `connection.test_failed`, `plugin.timeout`, `oauth.state_expired`.
- Plugin: `plugin.<id>.<code>` e.g. `plugin.trakt.rate_limited`.

`params` = template interpolation. `{ pluginName: "Trakt", reason: "network timeout" }`.

`devMessage` = English, viewer only. ⊥ user-facing.

### Code Registries

**Host** `server/errors/codes.ts`:

```ts
export interface ErrorCodeSpec {
  severity: "error" | "warning" | "info";
}

export const HOST_ERROR_CODES = {
  "connection.test_failed": { severity: "info" },
  "connection.not_found": { severity: "info" },
  "plugin.timeout": { severity: "error" },
  "plugin.output_invalid": { severity: "warning" },
  "plugin.input_invalid": { severity: "info" },
  "plugin.disabled": { severity: "info" },
  "oauth.state_expired": { severity: "info" },
  "oauth.polling_timeout": { severity: "info" },
  // ...
} as const satisfies Record<string, ErrorCodeSpec>;

export type HostErrorCode = keyof typeof HOST_ERROR_CODES;
```

New code → add code + severity = forced translation + decision. Discoverable, ⊥ drift.

**Plugin** via manifest, auto-namespaced:

```ts
// plugin manifest
errorCodes?: Record<string, string>;   // { test_failed: "Connection test failed" }
```

Ships English fallbacks; translations later.

### Frontend Rendering

i18next. Translation file `locales/<lang>/errors.json`:

```json
{
  "connection.test_failed": "Could not connect to {{pluginName}}: {{reason}}",
  "plugin.timeout": "The {{pluginName}} plugin took too long to respond.",
  "oauth.state_expired": "Authorization took too long and expired. Please try again."
}
```

Display helper:

```ts
function displayError(err: UserFacingError): string {
  return t(`errors:${err.code}`, { ...err.params, defaultValue: err.devMessage });
}
```

Logic: translation exists → use. Missing → `devMessage`. Plugin code without host translation → `manifest.errorCodes[code]` → `devMessage`.

Localization ⊥ block shipping.

### Discipline

⊥ user-facing errors via string concat anywhere.
∀ user-facing → `UserFacingError`.
Lint flags string-concat-to-toast. Review catches.

## Data Model

### `error_records`

```
error_records
├── id                  text PK                      (cuid2)
├── request_id          text NOT NULL
├── severity            text NOT NULL                ("error" | "warning" | "info")
├── source              text NOT NULL                ("frontend" | "backend" | "plugin" | "cron")
├── code                text                         (stable code | NULL for unhandled throws)
├── dev_message         text NOT NULL
├── stack               text                         (stack trace)
├── user_id             text FK → user.id            (NULL if unauthenticated)
├── plugin_id           text FK → plugins.id         (NULL unless plugin-source)
├── connection_id       text FK → service_connections.id  (NULL unless tied to connection)
├── route               text                         (oRPC procedure | frontend route)
├── http_status         integer                      (backend errors only; NULL)
├── context             text                         (JSON scrubbed blob)
├── created_at          integer NOT NULL
├── INDEX(created_at DESC)
├── INDEX(request_id)
├── INDEX(plugin_id, created_at DESC)
├── INDEX(severity, created_at DESC)
```

### `context` Blob

JSON + scrub pass on write. Debug context, ⊥ dump.

**Allowed**: oRPC input shape (names + types, ⊥ values), handler fields worked, plugin method, HTTP status, user agent.

**Scrubbed** (⊥ stored): ∀ value in credentials | `user_config` | `global_config`; keys matching pattern (`password`, `api_key`, `token`, `authorization`, `secret`, `credentials`, `apikey`, `api-key`); `Set-Cookie` | `Authorization` headers.

Scrubber: `server/errors/scrubber.ts`. Explicit patterns; additions reviewed.

**Credentials ⊥ enter error layer.** Sandbox throws ⊥ pull `ctx`. oRPC ⊥ auto-capture bodies. Arch guarantees, ⊥ scrubber as safety.

## Retention

Default 30d. Admin configurable 7–365d via UI. Nightly sweep: `DELETE WHERE created_at < now - retention_days * 86400`. Retention read once per sweep from global config.

## Forwarding Sink (Future Door)

Extension point: `ErrorSink` interface.

```ts
interface ErrorSink {
  capture(record: ErrorRecord): Promise<void>;
}
```

Built-in `DatabaseSink` → `error_records`. Future: Sentry, GlitchTip, webhook. Flow:

```
captureError(err, meta)
  ↓
[DatabaseSink.capture, ...additionalSinks.map(s => s.capture)]
  → Promise.allSettled
```

Sink fail independent. Downstream throw ⊥ block DB write. ⊥ v1 implementations — future-proof.

## Admin Viewer — `/admin/errors`

Permission: `admin:plugins` (no sprawl).

### Layout

- Title: "Errors"
- Subtitle: "Errors captured from frontend, backend, plugins."
- Widget: `{n}` errors last 24h + hourly sparkline (trend signal).
- Filter bar.
- Results table.

### Filters

| filter     | options                                                        |
| ---------- | -------------------------------------------------------------- |
| Severity   | default `error` only; toggle `warning` & `info` (multi-select) |
| Source     | frontend \| backend \| plugin \| cron (multi-select)           |
| Plugin     | dropdown installed (meaningful when source = plugin)           |
| Date range | 24h \| 7d \| 30d \| custom (date pickers)                      |
| Request ID | exact match                                                    |
| Search     | free-text `code` & `dev_message`                               |

Debounced apply. State → URL (shareable).

### Table

Cols: timestamp (relative + tooltip) | severity (icon+color: red/yellow/muted) | source (badge) | code (monospace) | summary (80 chars `dev_message`)

Clickable row → right sheet, newest-first, 50/page.

### Detail Sheet

shadcn `Sheet` right:

- Full `dev_message`, severity, source, code, timestamp, HTTP status.
- Route.
- Request ID **clickable** → filter table to chain.
- User ID (link to user page).
- Plugin & connection (link to admin).
- Stack trace (monospace + copy).
- Scrubbed `context` (pretty-printed JSON).

### Navigation Signal

Sidebar `/admin/errors` badge = `error` count last hour. Red @ threshold (v1 = count only, threshold later).

## Capture API

### Backend

```ts
// server/errors/capture.ts
export async function captureError(
  err: unknown,
  meta: {
    /** Optional. Derived from `code` if omitted. */
    severity?: "error" | "warning" | "info";
    source: ErrorSource;
    code?: string;
    route?: string;
    userId?: string;
    pluginId?: string;
    connectionId?: string;
    context?: Record<string, unknown>; // scrubbed on write
  },
): Promise<string>; // returns error record id
```

Called by oRPC middleware, plugin runtime, cron wrapper. Reads `requestId` from AsyncLocalStorage. `severity` optional → derived from code registry when omitted. Pass explicit to bump `error` → `warning`|`info` (recover | user-input). Writes ∀ sinks via `Promise.allSettled`. Returns record id.

### Frontend

```ts
// client/errors/report.ts
export async function reportError(
  err: unknown,
  severity: "error" | "warning" | "info",
  context?: Record<string, unknown>,
): Promise<void>;
```

Posts `/api/errors` with request ID, severity, JSON-safe error, context. Endpoint scrubs → writes `error_records` source `frontend`. Silent drop if fails (⊥ surface to user).

## Testing

| test        | coverage                                                     |
| ----------- | ------------------------------------------------------------ |
| Unit        | scrubber vs credentials/tokens/nested. ∀ sensitive removed.  |
| Integration | oRPC middleware: 5xx captured, expected 4xx user ⊥ captured. |
| Integration | plugin runtime: throw → record source + pluginId + stack.    |
| E2E         | frontend error → viewer with request ID → searchable.        |
| Integration | retention sweep: insert range → run → verify deletions.      |

## Open Questions / Deferred

| question            | status | note                                                                         |
| ------------------- | ------ | ---------------------------------------------------------------------------- |
| Alerting thresholds | v2     | "errors last hour > baseline" deferred. v1 = count; admins decide.           |
| Error grouping      | v2     | Sentry-style "400× same" deferred. v1 = raw; fingerprint column later.       |
| External sinks      | v2     | Interface v1; ⊥ concrete (DB only). Sentry/GlitchTip/webhook on demand.      |
| Incident pages      | v2     | "We know" banner across plugin breaks deferred. Connection card state OK v1. |
| Rate limiting       | v2?    | v1 assumes moderate. Add if volume high.                                     |
