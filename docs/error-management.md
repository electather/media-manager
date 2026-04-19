# Error Management for Plugins and API Endpoints

**Status:** Draft for review
**Date:** 2026-04-19
**Author:** Omid Astaraki
**Companions:** `2026-04-19-plugin-architecture-design.md`, `2026-04-19-frontend-connections-design.md`

## Summary

A unified error capture and viewing system spanning the frontend, backend oRPC layer, and plugin runtime. Errors are stored self-hosted in the app's database, correlated across surfaces via a shared request ID, and structured with stable error codes to enable user-facing translation in the future. An admin viewer at `/admin/errors` provides filtered search with request-ID chaining. The design keeps developer-facing debug context separate from user-facing messages, and excludes credentials from the error store by construction.

Product analytics (usage events, funnels, retention) is explicitly out of scope. This is a developer-debugging tool.

## Goals

- Capture unhandled and notable errors from three surfaces: frontend, backend oRPC handlers, and plugin sandbox invocations.
- Correlate a single user action across all three via a shared request ID.
- Store errors self-hosted; no data leaves the server by default.
- Structure errors to enable i18n of user-facing messages without retroactive refactoring.
- Expose an admin viewer for search, filter, and chain inspection.
- Keep the door open to forward errors to external services (Sentry, self-hosted GlitchTip, etc.) via a pluggable sink interface.

## Non-goals

- Product analytics, usage events, funnels, or retention tracking.
- Distributed tracing with spans. Request ID is the correlation primitive; span-level timing is a separate future concern.
- Performance metrics or APM. Different system, different design.
- Session replay or breadcrumbs.
- User-facing error reporting UI beyond a toast with a reference code.
- Alerting and paging. The viewer surfaces trends; actual alerting is deferred.

## Capture surfaces

Three capture points, each with its own integration strategy.

### Frontend

- **React error boundary** at the root of the app and at route boundaries. Catches render-time exceptions. Reports to `/api/errors` and shows a fallback UI with the request ID.
- **Global handlers**: `window.addEventListener("error", ...)` and `window.addEventListener("unhandledrejection", ...)` for things outside React's tree.
- **Explicit `reportError(err, severity, context?)`** helper for caught-but-notable cases (e.g. a fetch failed but we have a fallback).
- **oRPC client interceptor** reports non-2xx responses — but only tagged as warnings on the frontend, since the backend has already captured the authoritative error record. The frontend's role here is to note "the user saw this error" rather than duplicate the root cause.

### Backend

- **oRPC middleware** wraps every handler:
  - `5xx`-category thrown errors: captured as `error` severity, request ID stamped, rethrown.
  - `4xx` caused by handler bugs (our own schema validation failing on outgoing data, unexpected internal states): captured as `error`.
  - `4xx` caused by expected user input failures (auth denied, not found, validation on incoming user input): **not captured**. These are product behavior, not bugs.
- **Cron job failures** (`server/cron/*`) captured via a shared wrapper that logs the job name and the exception.

### Plugin runtime

Hooks into the existing sandbox error handling path described in the backend spec (§Plugin runtime, Error handling):

- Plugin throws inside the sandbox → runtime catches, records an error with `source: "plugin"`, `pluginId`, the sandbox stack trace, and the request ID, then marks the connection as errored (existing behavior).
- Plugin returns output that fails Zod validation → recorded as `warning` severity. This is the "recovered from malformed output" case: host returns empty results to the caller, but the event is worth knowing about.
- Sandbox OOM or timeout → recorded as `error` severity with the specific cause.

## Severity model

Two levels only:

- **`error`** — something broke in a way that indicates a bug or infrastructure failure. Default viewer filter shows these.
- **`warning`** — something unexpected happened but was recovered from. Not shown by default; toggle in viewer.

No `info`. Logs-for-the-sake-of-logs are not this system's job; use normal logging for that.

Explicit decision: expected user-input failures (bad password, invalid URL, permission denied) are neither. They don't enter the error store.

## Correlation — request ID

Every error carries a `requestId` (UUID). Surfaces:

- **Frontend**: generated once per page load (or per oRPC call, depending on scope) in the oRPC client. Sent in a `X-Request-Id` header.
- **Backend**: oRPC middleware reads the header or generates one if absent. Available via AsyncLocalStorage throughout the request lifecycle. Passed into the plugin runtime when it invokes a plugin.
- **Plugin runtime**: request ID is attached to `ctx.log` tags and used to stamp any captured errors.
- **Cron jobs**: generate their own request ID at job start, since there's no incoming request.

**Frontend surfacing:** When the frontend shows a user-visible error (toast, error boundary, card error state), it displays the request ID as a reference (e.g. `Ref: 7f3a2b1c`). The admin viewer supports searching by request ID, so a user can copy-paste the ref into a bug report and the admin can find the whole chain.

**Door open for OpenTelemetry:** the request ID maps cleanly to a trace ID in OTel. When the forwarding sink is added, mapping `requestId → traceId` is trivial. No refactor required.

## Translation — error codes and messages

User-facing and developer-facing messages are structured separately from the start. This is the design constraint that makes translation possible without a painful migration later.

### Wire format

Every error returned by oRPC or surfaced by a plugin to the host conforms to:

```ts
interface UserFacingError {
  code: string; // stable, namespaced, snake_case
  params?: Record<string, string | number>; // interpolation values
  devMessage: string; // English, free-form, for logs/viewer
  cause?: unknown; // original error (for viewer only)
  requestId?: string;
}
```

- `code` is the stable identifier used for translation lookup. Namespaced:
  - Host codes: `connection.test_failed`, `plugin.timeout`, `oauth.state_expired`, etc.
  - Plugin-emitted codes: `plugin.<plugin_id>.<code>`, e.g. `plugin.trakt.rate_limited`.
- `params` are interpolation values for the translation template. Example: `{ pluginName: "Trakt", reason: "network timeout" }`.
- `devMessage` is the English free-form text shown in the admin viewer. Never shown to users.

### Code registries

Two registries:

- **Host codes** live in `server/errors/codes.ts` as a union type. Adding a new error requires adding the code, which forces a translation entry. This keeps the code list discoverable and prevents drift.

  ```ts
  export const HOST_ERROR_CODES = [
    "connection.test_failed",
    "connection.not_found",
    "plugin.timeout",
    "plugin.output_invalid",
    "plugin.disabled",
    "oauth.state_expired",
    "oauth.polling_timeout",
    // ...
  ] as const;

  export type HostErrorCode = (typeof HOST_ERROR_CODES)[number];
  ```

- **Plugin codes** are declared in the plugin manifest and namespaced automatically. Plugins ship English fallbacks in their manifest; translations are contributed later by whoever cares about localization.

  ```ts
  // plugin manifest addition
  errorCodes?: Record<string, string>;   // { test_failed: "Connection test failed" }
  ```

### Frontend rendering

Frontend uses i18next (or equivalent). Translation files live under `locales/<lang>/errors.json`:

```json
{
  "connection.test_failed": "Could not connect to {{pluginName}}: {{reason}}",
  "plugin.timeout": "The {{pluginName}} plugin took too long to respond.",
  "oauth.state_expired": "Authorization took too long and expired. Please try again."
}
```

A single helper handles display:

```ts
function displayError(err: UserFacingError): string {
  return t(`errors:${err.code}`, { ...err.params, defaultValue: err.devMessage });
}
```

- If a translation exists, it's used.
- If not, the `devMessage` is shown as a fallback. Localization is never a blocker for shipping a new error.
- For plugin-namespaced codes without a host translation, the plugin's declared English fallback (from `manifest.errorCodes[code]`) is used before falling back to `devMessage`.

### Discipline

No user-facing error message is constructed by string concatenation anywhere in the codebase. All user-facing errors go through `UserFacingError`. A lint rule flags direct string-concatenation-to-toast patterns. Violation is caught in code review.

## Data model

### `error_records`

The table backing the error store.

```
error_records
├── id                  text PK                      (cuid2)
├── request_id          text NOT NULL
├── severity            text NOT NULL                ("error" | "warning")
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

### What goes in `context`

A JSON blob with a declared scrubbing pass on write. Purpose is to carry debugging context without becoming a dumping ground.

- **Allowed, useful**: the oRPC procedure's input shape (field names and types, not values), the specific fields the handler was working on when it failed, plugin method name being called, HTTP status, user agent (from request headers).
- **Disallowed, scrubbed**: any value in credentials, user_config, or global_config; any key matching the scrubber pattern list (`password`, `api_key`, `token`, `authorization`, `secret`, `credentials`, `apikey`, `api-key` — case-insensitive); any `Set-Cookie` or `Authorization` headers.

Scrubber lives in `server/errors/scrubber.ts`. Pattern list is explicit; additions are reviewed.

**Credentials never enter the error layer in the first place.** The plugin runtime catches sandbox throws without pulling `ctx` into the error record. The oRPC middleware does not auto-capture request bodies. Both are architectural guarantees, not scrubber fallback.

## Retention

- Default: 30 days.
- Admin-configurable in the admin UI, range 7–365 days.
- Nightly sweep deletes `WHERE created_at < now - retention_days * 86400`.
- Retention is stored in a global app config row, read once per sweep.

## Forwarding sink (future door)

The error store has a single extension point: an `ErrorSink` interface.

```ts
interface ErrorSink {
  capture(record: ErrorRecord): Promise<void>;
}
```

The built-in implementation is `DatabaseSink`, which writes to `error_records`. Additional sinks (Sentry, GlitchTip, webhook) can be registered later. The capture path is:

```
captureError(err, meta)
  ↓
[DatabaseSink.capture, ...additionalSinks.map(s => s.capture)]
  → Promise.allSettled
```

Sinks fail independently. A downstream sink throwing does not prevent the DatabaseSink from writing. No additional sinks in v1 — this is purely about not having to refactor later.

## Admin viewer — `/admin/errors`

Permission: `admin:plugins` (same tier as plugin management; no separate permission to avoid sprawl).

### Layout

- Title: "Errors"
- Subtitle (muted): "Errors captured from the frontend, backend, and plugins."
- Aggregate widget at the top: "`{n}` errors in the last 24h" with a small sparkline showing per-hour counts. This is a "is the trend bad" signal, not a dashboard.
- Filter bar below the widget.
- Results table.

### Filters

- **Severity**: defaults to `error` only; toggle shows `warning` too. Multi-select.
- **Source**: frontend / backend / plugin / cron. Multi-select.
- **Plugin**: dropdown populated from installed plugins. Only meaningful when source includes `plugin`.
- **Date range**: last 24h / 7d / 30d / custom. Custom uses date pickers.
- **Request ID**: free-text input. Exact match.
- **Search**: free-text search across `code` and `dev_message`.

Filters apply as the user sets them (debounced for the text inputs). State is persisted to the URL so admins can share filtered links.

### Table

Columns (in order):

- Timestamp (relative, with tooltip showing absolute)
- Severity (icon + color: red for error, yellow for warning)
- Source (badge: frontend / backend / plugin / cron)
- Code (monospace, truncated to fit)
- Summary (first ~80 chars of `dev_message`)

Rows are clickable; click opens a drawer on the right with full details. Sort by newest-first by default. Pagination (50 per page).

### Detail drawer

When a row is clicked, a shadcn `Sheet` opens from the right showing:

- Full `dev_message`
- Severity, source, code, timestamp, HTTP status (if any)
- Route
- Request ID — **clickable**, filters the table to just this request ID so the admin can see the full chain of errors from a single user action. Big debugging win.
- User ID (linked to user detail page if that exists; otherwise just shown)
- Plugin and connection (if applicable, linked to their respective admin pages)
- Stack trace in a monospace code block with copy button
- Scrubbed `context` JSON, pretty-printed

### Navigation signal

In the admin sidebar/header, the link to `/admin/errors` shows a small badge with the count of `error`-severity records in the last hour. Badge turns red when that count exceeds a threshold (defer threshold design; for v1, just show the count). This is the minimum-viable "something is wrong right now" signal.

## Capture API

### Backend

```ts
// server/errors/capture.ts
export async function captureError(
  err: unknown,
  meta: {
    severity: "error" | "warning";
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

- Called by the oRPC middleware, the plugin runtime, and the cron wrapper.
- Reads `requestId` from AsyncLocalStorage.
- Writes to all configured sinks via `Promise.allSettled`.
- Returns the record id so the caller can include it in a response to the frontend if needed.

### Frontend

```ts
// client/errors/report.ts
export async function reportError(
  err: unknown,
  severity: "error" | "warning",
  context?: Record<string, unknown>,
): Promise<void>;
```

- Posts to `/api/errors` with the current request ID, severity, a JSON-safe serialization of the error, and optional context.
- The endpoint scrubs and writes to `error_records` with `source: "frontend"`.
- Silently drops if the post itself fails — we're not going to surface "error capture failed" to users.

## Testing

- Unit tests for the scrubber against a fixture of records that contain credentials, tokens, and nested sensitive data. Must pass with all sensitive fields removed.
- Integration tests for the oRPC middleware: 5xx throws are captured, expected 4xx user errors are not.
- Integration tests for the plugin runtime capture path: plugin throw → record with correct `source`, `pluginId`, stack.
- E2E test: trigger an error from the frontend, verify it appears in the admin viewer with the correct request ID and can be found by searching on that ID.
- Retention sweep test: insert records across a date range, run sweep, verify correct deletions.

## Open questions / deferred

- **Alerting thresholds.** The "errors in the last hour exceeding baseline" signal is deferred. V1 just shows the count; admins decide what's too high.
- **Error grouping/fingerprinting.** Sentry-style "this is the same error you've seen 400 times" grouping is deferred. V1 shows the raw records; adding a fingerprint column and a group view is a later enhancement.
- **External sink implementations.** Interface is in v1; no concrete implementations beyond the database. Sentry/GlitchTip/webhook sinks added when there's demand.
- **User-visible incident pages.** When a plugin is broken across many users, a simple "we know about this" banner could be surfaced. Deferred — the connection card's own error state is enough for v1.
- **Rate limiting capture.** If something goes very wrong and errors flood in, the capture path itself could become a problem. V1 assumes moderate volume; rate limiting is added if observed.
