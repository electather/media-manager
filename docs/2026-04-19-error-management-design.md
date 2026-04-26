# Error Management — Plugins & API Endpoints

**Status:** Draft for review
**Date:** 2026-04-19
**Author:** Omid Astaraki
**Companions:** `2026-04-19-plugin-architecture-design.md`, `2026-04-19-frontend-connections-design.md`

## Summary

Unified error capture & viewing system spanning frontend, backend oRPC layer, plugin runtime. Errors stored self-hosted in app DB, correlated via shared request ID, structured with stable error codes for future user-facing i18n. Admin viewer at `/admin/errors` — filtered search + request-ID chaining. Dev debug context ⊥ user messages. Credentials ⊥ error store (by construction).

Product analytics ⊥ scope. Dev-debugging tool only.

## Goals

- Capture unhandled + notable errors from 3 surfaces: frontend, backend oRPC handlers, plugin sandbox.
- Correlate single user action across all 3 via shared request ID.
- Store self-hosted; no data leaves server by default.
- Structure errors → i18n user messages without retroactive refactor.
- Admin viewer: search, filter, chain inspection.
- Extension point → forward to external sinks (Sentry, GlitchTip) via pluggable `ErrorSink`.

## Non-goals

⊥ product analytics, usage events, funnels, retention.
⊥ distributed tracing with spans (request ID = correlation primitive; span timing → separate future concern).
⊥ performance metrics / APM.
⊥ session replay / breadcrumbs.
⊥ user-facing error reporting UI beyond toast + reference code.
⊥ alerting / paging (viewer surfaces trends; alerting deferred).

## Capture Surfaces

3 capture points, each with own integration strategy.

### Frontend

- **React error boundary** at root + route boundaries → catches render-time exceptions → reports to `/api/errors` → shows fallback UI with request ID.
- **Global handlers**: `window.addEventListener("error", ...)` & `window.addEventListener("unhandledrejection", ...)` — outside React tree.
- **Explicit `reportError(err, severity, context?)`** — caught-but-notable cases (e.g. fetch failed but fallback exists).
- **oRPC client interceptor** — non-2xx → tagged `warning` on frontend only. Backend captured authoritative record; frontend notes "user saw this error", not root cause.

### Backend

- **oRPC middleware** wraps ∀ handler:
  - `5xx` thrown errors → `error` severity, request ID stamped, rethrown.
  - `4xx` from handler bugs (schema validation fail on outgoing data, unexpected internal state) → `error`.
  - `4xx` from expected user input failures (auth denied, not found, validation on incoming input) → ⊥ captured. Product behavior, not bugs.
- **Cron failures** → shared wrapper logs job name + exception.

### Plugin Runtime

Hooks into existing sandbox error path (§Plugin runtime, Error handling):

- Plugin throws inside sandbox → runtime catches → record with `source: "plugin"`, `pluginId`, sandbox stack, request ID → mark connection errored.
- Plugin output fails Zod validation → `warning` severity. Host returns empty results to caller; event worth recording.
- Sandbox OOM | timeout → `error` severity with specific cause.

## Severity Model

3 levels:

- **`error`** — bug | infrastructure failure. Default viewer filter shows these.
- **`warning`** — unexpected but recovered (plugin malformed output → fell back to empty, pool exhausted → rotated). Off by default; viewer toggle.
- **`info`** — expected user-input failure (bad URL, wrong password, stale 404, permission denied). Stored; admin can toggle on when debugging specific user flow. ⊥ shown by default — would drown bug signal.

`info` ≠ generic logs. Scoped to user-input failures only.

### Severity Lives on Code, Not Callsite

∀ stable error code → default severity in codes registry (`server/src/errors/codes.ts`). Registry = single source of truth:

```ts
export const HOST_ERROR_CODES = {
  "plugin.input_invalid": { severity: "info" },
  "plugin.bad_credentials": { severity: "info" },
  "plugin.upstream_error": { severity: "error" },
  "plugin.output_invalid": { severity: "warning" },
  // ...
} as const satisfies Record<string, ErrorCodeSpec>;
```

Per-code object shape (not flat `Record<code, severity>`) → room to grow: translation hints, default HTTP status, category, whether to echo request ID to user. No breaking refactor of ∀ consumer.

`captureError` consults registry → effective severity:

1. Caller passes explicit `severity` → wins (recovered paths bumping `error` code → `warning`).
2. Otherwise → code's registered severity.
3. Unknown codes (incl. `plugin.<id>.<code>` from plugins) → `error`. Over-capture > silent drop.

"Is this worth storing at what severity" decision → one place, not ∀ try/catch. Callsites ⊥ carry ritual `severity: "error"`. Exceptions = paths genuinely diverging from registered default.

## Correlation — Request ID

∀ error carries `requestId` (UUID). Surfaces:

- **Frontend**: generated once per page load (or per oRPC call) in oRPC client. Sent via `X-Request-Id` header.
- **Backend**: oRPC middleware reads header | generates if absent. Available via AsyncLocalStorage through request lifecycle. Passed to plugin runtime on invocation.
- **Plugin runtime**: request ID → `ctx.log` tags & error record stamp.
- **Cron jobs**: generate own request ID at job start (no incoming request).

**Frontend surfacing:** User-visible error (toast, error boundary, card error state) → display request ID as reference (e.g. `Ref: 7f3a2b1c`). Admin viewer supports search by request ID → user copy-pastes ref into bug report → admin finds full chain.

**OTel door:** request ID maps cleanly to OTel trace ID. When forwarding sink added, `requestId → traceId` = trivial. ⊥ refactor required.

## Translation — Error Codes & Messages

User-facing & dev-facing messages structured separately. Constraint: translation possible ⊥ painful migration.

### Wire Format

∀ error returned by oRPC | surfaced by plugin to host conforms to:

```ts
interface UserFacingError {
  code: string; // stable, namespaced, snake_case
  params?: Record<string, string | number>; // interpolation values
  devMessage: string; // English, free-form, for logs/viewer
  cause?: unknown; // original error (viewer only)
  requestId?: string;
}
```

- `code` = stable ID for translation lookup. Namespaced:
  - Host codes: `connection.test_failed`, `plugin.timeout`, `oauth.state_expired`.
  - Plugin-emitted: `plugin.<plugin_id>.<code>`, e.g. `plugin.trakt.rate_limited`.
- `params` = interpolation values for translation template. E.g. `{ pluginName: "Trakt", reason: "network timeout" }`.
- `devMessage` = English free-form, admin viewer only. ⊥ shown to users.

### Code Registries

2 registries:

- **Host codes** in `server/errors/codes.ts` — keyed object of per-code specs. New error → add code + default severity → forces translation entry + severity decision. Keeps code list discoverable; prevents drift.

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

- **Plugin codes** declared in plugin manifest, namespaced automatically. Plugins ship English fallbacks in manifest; translations contributed later.

  ```ts
  // plugin manifest addition
  errorCodes?: Record<string, string>;   // { test_failed: "Connection test failed" }
  ```

### Frontend Rendering

Frontend uses i18next (or equivalent). Translation files → `locales/<lang>/errors.json`:

```json
{
  "connection.test_failed": "Could not connect to {{pluginName}}: {{reason}}",
  "plugin.timeout": "The {{pluginName}} plugin took too long to respond.",
  "oauth.state_expired": "Authorization took too long and expired. Please try again."
}
```

Single helper handles display:

```ts
function displayError(err: UserFacingError): string {
  return t(`errors:${err.code}`, { ...err.params, defaultValue: err.devMessage });
}
```

- Translation exists → use it.
- Translation missing → `devMessage` fallback. Localization ⊥ blocks shipping new error.
- Plugin-namespaced code without host translation → plugin's declared English fallback from `manifest.errorCodes[code]` before `devMessage`.

### Discipline

⊥ user-facing error messages via string concatenation anywhere in codebase.
∀ user-facing errors → `UserFacingError`.
Lint rule flags direct string-concatenation-to-toast patterns. Violation caught in code review.

## Data Model

### `error_records`

```
error_records
├── id                  text PK                      (cuid2)
├── request_id          text NOT NULL
├── severity            text NOT NULL                ("error" | "warning" | "info")
├── source              text NOT NULL                ("frontend" | "backend" | "plugin" | "cron")
├── code                text                         (stable error code if available; nullable for unhandled throws without a code)
├── dev_message         text NOT NULL
├── stack               text                         (stack trace as-received)
├── user_id             text FK → user.id            (nullable; set when request was authenticated)
├── plugin_id           text FK → plugins.id         (nullable; set for plugin-source errors)
├── connection_id       text FK → service_connections.id  (nullable; set when error is tied to a specific connection)
├── route               text                         (oRPC procedure name or frontend route)
├── http_status         integer                      (for backend errors; nullable)
├── context             text                         (JSON blob, scrubbed; see below)
├── created_at          integer NOT NULL
├── INDEX(created_at DESC)
├── INDEX(request_id)
├── INDEX(plugin_id, created_at DESC)
├── INDEX(severity, created_at DESC)
```

### `context` Blob

JSON blob with declared scrubbing pass on write. Carries debug context ⊥ dumping ground.

- **Allowed**: oRPC procedure input shape (field names + types, ⊥ values), fields handler worked on when failed, plugin method name, HTTP status, user agent.
- **Disallowed, scrubbed**: ∀ value in credentials | `user_config` | `global_config`; ∀ key matching scrubber pattern (`password`, `api_key`, `token`, `authorization`, `secret`, `credentials`, `apikey`, `api-key` — case-insensitive); `Set-Cookie` | `Authorization` headers.

Scrubber in `server/errors/scrubber.ts`. Pattern list explicit; additions reviewed.

**Credentials ⊥ enter error layer in first place.** Plugin runtime catches sandbox throws ⊥ pulling `ctx` into record. oRPC middleware ⊥ auto-captures request bodies. Architectural guarantees, ⊥ scrubber fallback.

## Retention

- Default: 30 days.
- Admin-configurable in admin UI, range 7–365 days.
- Nightly sweep: `DELETE WHERE created_at < now - retention_days * 86400`.
- Retention stored in global app config row, read once per sweep.

## Forwarding Sink (Future Door)

Single extension point: `ErrorSink` interface.

```ts
interface ErrorSink {
  capture(record: ErrorRecord): Promise<void>;
}
```

Built-in = `DatabaseSink` → writes to `error_records`. Additional sinks (Sentry, GlitchTip, webhook) registered later. Capture path:

```
captureError(err, meta)
  ↓
[DatabaseSink.capture, ...additionalSinks.map(s => s.capture)]
  → Promise.allSettled
```

Sinks fail independently. Downstream sink throw ⊥ prevent `DatabaseSink` write. ⊥ additional sinks in v1 — avoids future refactor.

## Admin Viewer — `/admin/errors`

Permission: `admin:plugins` (same tier as plugin management; ⊥ separate permission → avoids sprawl).

### Layout

- Title: "Errors"
- Subtitle (muted): "Errors captured from the frontend, backend, and plugins."
- Aggregate widget top: "`{n}` errors in last 24h" + small sparkline (per-hour counts). "Is trend bad" signal, ⊥ dashboard.
- Filter bar below widget.
- Results table.

### Filters

- **Severity**: default = `error` only; toggles reveal `warning` & `info`. Multi-select. `info` off by default → ⊥ drown bug signal.
- **Source**: frontend | backend | plugin | cron. Multi-select.
- **Plugin**: dropdown from installed plugins. Meaningful when source includes `plugin`.
- **Date range**: last 24h | 7d | 30d | custom. Custom → date pickers.
- **Request ID**: free-text, exact match.
- **Search**: free-text across `code` & `dev_message`.

Filters apply as user sets (debounced for text inputs). State → URL (shareable filtered links).

### Table

Columns:

- Timestamp (relative + absolute tooltip)
- Severity (icon + color: red = error, yellow = warning, muted = info)
- Source (badge: frontend | backend | plugin | cron)
- Code (monospace, truncated)
- Summary (first ~80 chars of `dev_message`)

Rows clickable → drawer right with full details. Sort newest-first. Pagination 50/page.

### Detail Drawer

shadcn `Sheet` from right showing:

- Full `dev_message`
- Severity, source, code, timestamp, HTTP status (if any)
- Route
- Request ID — **clickable** → filters table to this request ID → full chain of errors from single user action.
- User ID (linked to user detail page if exists)
- Plugin & connection (if applicable, linked to admin pages)
- Stack trace in monospace code block with copy button
- Scrubbed `context` JSON, pretty-printed

### Navigation Signal

Admin sidebar/header `/admin/errors` link → small badge with `error`-severity count from last hour. Badge turns red when count exceeds threshold (threshold design deferred; v1 = just show count). Min-viable "something wrong right now" signal.

## Capture API

### Backend

```ts
// server/errors/capture.ts
export async function captureError(
  err: unknown,
  meta: {
    /** Optional. When omitted, derived from `code` via the registry in ./codes. */
    severity?: "error" | "warning" | "info";
    source: ErrorSource;
    code?: string;
    route?: string;
    userId?: string;
    pluginId?: string;
    connectionId?: string;
    context?: Record<string, unknown>; // will be scrubbed
  },
): Promise<string>; // returns the new error record id
```

- Called by oRPC middleware, plugin runtime, cron wrapper.
- Reads `requestId` from AsyncLocalStorage.
- `severity` optional → derived from `code` via `server/errors/codes.ts` when omitted. Pass explicitly to bump normally-`error` code → `warning`|`info` on recovered | user-input path.
- Writes to ∀ configured sinks via `Promise.allSettled`.
- Returns record id → caller can include in response to frontend.

### Frontend

```ts
// client/errors/report.ts
export async function reportError(
  err: unknown,
  severity: "error" | "warning" | "info",
  context?: Record<string, unknown>,
): Promise<void>;
```

- Posts to `/api/errors` with current request ID, severity, JSON-safe error serialization, optional context.
- Endpoint scrubs → writes to `error_records` with `source: "frontend"`.
- Silent drop if post fails — ⊥ surface "error capture failed" to users.

## Testing

- Unit tests: scrubber against fixture with credentials, tokens, nested sensitive data. ∀ sensitive fields removed.
- Integration tests: oRPC middleware — 5xx captured, expected 4xx user errors ⊥ captured.
- Integration tests: plugin runtime path — plugin throw → record with correct `source`, `pluginId`, stack.
- E2E: trigger error from frontend → verify appears in admin viewer with correct request ID → findable by search.
- Retention sweep: insert records across date range → run sweep → verify correct deletions.

## Open Questions / Deferred

- **Alerting thresholds.** "Errors in last hour exceeding baseline" signal deferred. v1 shows count; admins decide threshold.
- **Error grouping/fingerprinting.** Sentry-style "same error 400×" grouping deferred. v1 = raw records; fingerprint column + group view → later enhancement.
- **External sink implementations.** Interface in v1; ⊥ concrete beyond DB. Sentry/GlitchTip/webhook sinks added on demand.
- **User-visible incident pages.** "We know about this" banner when plugin broken across many users. Deferred — connection card error state enough for v1.
- **Rate limiting capture.** v1 assumes moderate volume; rate limiting added if observed.
