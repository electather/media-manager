# Job Service

**Status:** Draft for review (revised)
**Date:** 2026-04-20 (revised 2026-04-21)
**Author:** Omid Astaraki
**Depends on:** `2026-04-19-plugin-architecture-design.md`, `2026-04-19-media-service-design.md`, `2026-04-19-error-management-design.md`
**Revises (on merge):** Plugin architecture doc §Lifecycle (token refresh and scheduled work); error-management doc §Capture surfaces (cron wrapper); media-service doc §Testing (where jobs are referenced)

## Summary

A single host-side service that owns the registration, execution, and observability of every background job in the system. Four job kinds cover the shapes of work that have been showing up independently across the existing specs: `scheduled` (a handler fires on cron), `scheduled_per_row` (a handler iterates rows from a query), `triggerable` (a handler runs on explicit API call, optionally also on cron), and `coalesced` (a handler runs debounced after a burst of triggers). Each kind has its own focused registration API.

Every registered job carries a human-readable `name` and optional `description` surfaced in the admin UI, plus per-run structured logs viewable in the admin drawer. The service integrates with the existing error-management pipeline so failed runs are captured, scrubbed, and correlated with other errors via the shared request ID. An admin surface at `/admin/jobs` mirrors the `/admin/errors` page — list, filter, detail drawer, one-click jump from a failed run to its full error record. Admins can trigger any job, including feature-scoped jobs on behalf of a specific user (audit trail captures both the acting admin and the target user). Users can additionally trigger feature-scoped jobs on their own data through a separate endpoint that checks feature-level permissions.

Every existing job in the codebase migrates to this service with no behavior change. New jobs register through the service's API rather than directly through `croner`.

## Goals

- One place to register and observe background jobs, regardless of origin (host-internal, plugin-declared, feature-triggered).
- Distinct APIs for the four job shapes we actually have, so callers don't re-implement iteration, debouncing, or concurrency control.
- Human-readable metadata (`name`, `description`) on every job so the admin UI is operationally useful, not just technically correct.
- Structured run history with retention that surfaces failures prominently and bounds storage for successes.
- Per-run structured logs captured and persisted so admins can debug failures without needing stdout access.
- Admin surface that enables operations: enable/disable, re-schedule, trigger on demand (including scheduled jobs outside their cron window, and feature-scoped jobs against a chosen target user), cancel, inspect recent runs and linked errors, review logs.
- User-scoped triggering for features like "Rebuild profile" without granting broad `admin:jobs` access.
- Integration with the error-management pipeline — failed runs produce `error_records` correlated by `request_id`.
- Migrate the existing ad-hoc job registrations without changing their behavior.

## Non-goals

- Distributed coordination for multi-instance deployments. V1 requires single-instance for jobs; documented operational constraint. Postgres advisory locks are the natural follow-up when this changes.
- Parallelism across rows within `scheduled_per_row`. Rows iterate sequentially in v1.
- Built-in retry-on-failure at the job level. Handlers own retry logic.
- Cross-job dependencies or DAGs. A job that depends on another calls the other's trigger explicitly.
- Event bus or pub/sub. Jobs do not communicate through implicit channels.
- Worker isolation beyond the existing plugin sandbox. Host-internal jobs run in the host process.
- Live log tailing (SSE or WebSocket) during long-running jobs. Logs are viewable after the run completes; deferred with the broader streaming work.

## Architecture

```
                  ┌──────────────────────────────────────┐
                  │ Registrants                          │
                  │   host modules (auth, errors, ...)   │
                  │   plugin runtime (manifest.jobs)     │
                  │   features (preference engine, ...)  │
                  └──────────────────┬───────────────────┘
                                     │  registerScheduled / registerScheduledPerRow /
                                     │  registerTriggerable / registerCoalesced
                                     ▼
                  ┌──────────────────────────────────────┐
                  │ Job Service                          │
                  │  • Registry (in-memory)              │
                  │  • Runner (concurrency, timing)      │
                  │  • Croner adapter                    │
                  │  • Coalesce timers                   │
                  │  • Run logger (ALS-scoped buffer)    │
                  │  • History writer + pruner           │
                  │  • Config reader (enabled/override)  │
                  └───────┬──────────────────────┬───────┘
                          │                      │
                          ▼                      ▼
              ┌──────────────────┐     ┌──────────────────┐
              │ Error mgmt       │     │ Postgres         │
              │  captureError    │     │  job_runs        │
              │  request_id      │     │  job_config      │
              └──────────────────┘     └──────────────────┘

                          ▲
                          │  HTTP (Hono)
                          │
                  ┌───────┴────────────────────┐
                  │ /api/jobs                  │
                  │  • GET       list/detail   │  (admin:jobs)
                  │  • trigger   (admin path)  │  (admin:jobs — any job)
                  │  • trigger-user            │  (feature permission check)
                  │  • cancel, config          │  (admin:jobs)
                  └────────────────────────────┘
```

The service has three concerns:

- **Registration and lifecycle.** Four registration functions, one per kind. All jobs register through the service; nothing touches `croner` directly except the adapter. Plugin jobs register through the plugin runtime's install/enable path, which wraps the plugin's handler in a `PluginContext` builder and calls the appropriate registration function. On plugin disable/uninstall, the runtime calls `unregister(jobId)`.
- **Execution.** A thin runner wraps each handler invocation with: concurrency control (in-memory `running` set keyed on `jobId` or `jobId:scopeKey`), timing, logging (see §Logging), timeout enforcement, abort-signal propagation, error capture, and `job_runs` writes. Each kind has its own small module implementing its specific dispatch semantics on top of the runner.
- **Admin API.** Read and write endpoints for the `/admin/jobs` page and for feature-driven user triggers. Permission split: `admin:jobs` for the full admin surface; feature-level permission checks for user-scoped triggers. Admins can trigger feature-scoped jobs through the admin endpoint (see §HTTP API for audit details).

The service lives at `server/jobs/` and is a peer of `server/media-service/`, `server/mcp/`, `server/plugin-runtime/`, and `server/errors/`. It has no dependencies on those peers beyond `server/errors/` (for `captureError`). `MediaService` and the plugin runtime depend on it, not the other way around.

## Shared types

Every kind returns a `JobHandle` used to introspect or manipulate the job at runtime:

```ts
interface JobHandle {
  id: string;
  name: string; // human-readable, required at registration
  description?: string; // human-readable, optional
  kind: "scheduled" | "scheduled_per_row" | "triggerable" | "coalesced";
  enabled: boolean;
  schedule?: string; // cron expression, for scheduled kinds
  lastRun?: JobRun;
  nextRun?: Date; // for scheduled kinds; undefined for triggerable
  adminTriggerable: boolean; // admin can call /trigger with no user context
  userTriggerable: boolean; // feature-scoped; admin call requires target user
  inputSchema?: JSONSchema; // echoed to admin UI for form generation
}
```

`name` and `description` are code-declared at registration (not persisted) — same status as `inputSchema`. `name` is required for all kinds; `description` is optional but encouraged.

`adminTriggerable` and `userTriggerable` replace the previous single `adminTriggerable` flag:

- `adminTriggerable: true` when the admin can trigger the job without specifying a target user (admin-owned jobs, or scheduled jobs with `adminTriggerable: true` opt-in).
- `userTriggerable: true` when the job is feature-scoped — admin can still trigger it, but must supply target user context; non-admin users reach it only through `/trigger-user`.

The admin UI uses `adminTriggerable || userTriggerable` to decide whether to show the trigger button, and the flag's identity to decide which form shape to render.

Every handler receives a `JobRunContext`:

```ts
interface JobRunContext {
  runId: string; // cuid2, corresponds to job_runs.id
  triggeredBy: "cron" | "admin" | "user" | "feature";
  triggeredByUserId?: string; // the acting principal (admin id when admin triggers)
  scopeKey?: string; // the target of the run (e.g. target user id)
  requestId: string; // from AsyncLocalStorage or freshly generated
  logger: Logger; // tees to stdout + run log buffer (see §Logging)
  abortSignal: AbortSignal; // honored at handler-chosen break points
}
```

`triggeredByUserId` is the acting principal (the admin when an admin triggers on behalf of a user). `scopeKey` is the target of the work. For admin-triggered feature jobs these differ; for user-triggered jobs they match.

The `abortSignal` is how the "cancel" button works — the job service sets abort when a cancel is requested; handlers check it at natural break points. Handlers that don't check run to completion, which is fine for short-lived jobs.

`requestId` is threaded through to `captureError` and `logger` so failed runs correlate with the error-management pipeline exactly as MCP calls and Hono handlers do. When a job is triggered by a feature, the trigger call propagates the caller's request ID into the job's run context.

## Job kinds

All four kinds share `id`, `name`, `description?` at registration. Shown below on each signature for clarity.

### `registerScheduled`

The simplest kind. Fires on a cron tick with no iteration.

```ts
function registerScheduled(opts: {
  id: string; // globally unique
  name: string; // human-readable
  description?: string;
  schedule: string; // cron expression (croner syntax)
  handler: (ctx: JobRunContext) => Promise<void>;
  timeoutSec?: number; // default 300
  adminTriggerable?: boolean; // default false; exposes /trigger for force-run
  capture?: { source?: "cron" | "plugin"; pluginId?: string };
}): JobHandle;
```

Semantics:

- On cron tick: if a previous run is active, the tick is written as `skipped` in `job_runs` and nothing else happens.
- Otherwise, the handler runs inside the runner wrapper. Success or failure is recorded.
- `adminTriggerable: true` exposes the job at `POST /api/jobs/:id/trigger` with no input (runs the handler as if cron had fired, with `triggeredBy: "admin"`). Skip-if-running applies — if the cron tick is mid-run, manual trigger returns `job.already_running`.
- `capture` controls how failures are labeled in the error pipeline: host-internal jobs use `{ source: "cron" }`; plugin jobs pass `{ source: "plugin", pluginId }`.

Used for: `pending_auth` sweep, `plugin_store` expired-row sweep, `error_records` retention sweep, plugin-global scheduled jobs.

### `registerScheduledPerRow`

Iterates a row source each tick; handler is called once per row sequentially.

```ts
function registerScheduledPerRow<TRow>(opts: {
  id: string;
  name: string;
  description?: string;
  schedule: string;
  rowSource: () => Promise<TRow[]>;
  handler: (ctx: JobRunContext, row: TRow) => Promise<void>;
  perRowTimeoutSec?: number; // default 60
  runTimeoutSec?: number; // default 30 * 60
  continueOnRowError?: boolean; // default true
  adminTriggerable?: boolean; // default false
  capture?: { source?: "cron" | "plugin"; pluginId?: string };
}): JobHandle;
```

Semantics:

- Skip-if-running at the job level; a second tick (or manual trigger) during iteration is `skipped` / `job.already_running`.
- `rowSource()` is called once at the start of the run; the result iterates sequentially.
- Per-row errors are captured as individual `error_records` entries but the run continues unless `continueOnRowError: false`.
- `adminTriggerable: true` enables force-run. Because these jobs can process many rows, the admin UI shows a confirmation dialog with the current row count ("this will process N items") before firing.
- The `job_runs` entry records aggregate stats: `rows_total`, `rows_succeeded`, `rows_failed`. Run status: all succeeded → `succeeded`; some failed → `partial_failure`; all failed → `failed`; run timeout reached → `timed_out`; cancel requested → `cancelled`.
- The first row failure's `error_record_id` is stored on the `job_runs` row; all per-row failures share the run's `request_id`.
- Per-row context: each row's identifier (whatever `rowSource` returns, best-effort stringified — row primary key if present) is tagged onto all log entries emitted during that row's handler invocation, so the log viewer can filter by row.

Used for: plugin `perConnection: true` jobs, daily preference-profile rebuild.

### `registerTriggerable`

Runs on explicit call. Optionally also on cron.

```ts
function registerTriggerable<TInput, TResult = unknown>(opts: {
  id: string;
  name: string;
  description?: string;
  schedule?: string; // if present, also runs on cron with `input: null`
  handler: (ctx: JobRunContext, input: TInput | null) => Promise<TResult>;
  scopeKey?: (input: TInput) => string;
  timeoutSec?: number;
  inputSchema?: JSONSchema; // ajv-validated; annotations drive admin form
  requiredPermission:
    | "admin:jobs"
    | { kind: "feature"; check: (userId: string, input: TInput) => Promise<boolean> };
}): TriggerableJobHandle<TInput, TResult>;

interface TriggerableJobHandle<TInput, TResult> extends JobHandle {
  trigger(input: TInput, triggeredBy: TriggerSource): Promise<{ runId: string; result: TResult }>;
}
```

Semantics:

- Without `scopeKey`: skip-if-running behaves like `scheduled` (concurrent triggers return `job.already_running`).
- With `scopeKey`: triggers with different scope keys run in parallel; same scope key + already running → `job.already_running`.
- `inputSchema` validated before handler invocation; failure returns `job.bad_input` before the handler is touched.
- `requiredPermission` gates the **user** path (`/trigger-user`). Both values allow the **admin** path (`/trigger`):
  - `admin:jobs` jobs are admin-only everywhere. Reachable only via `/trigger`.
  - `{ kind: "feature", check }` jobs are reachable by users via `/trigger-user` (feature's `check` gates access) **and** by admins via `/trigger` (admin's `admin:jobs` token is the authorization; feature check is bypassed, but the admin must still supply the input including any `scopeKey`-producing field).
- `handler` returns a value; the value is serialized into `job_runs.result` (JSON, truncated at ~4KB with a warning logged on truncation) and returned to the caller.

**`inputSchema` annotations for the admin form:** the admin UI renders a form from `inputSchema` when triggering. To guide the form without string-matching field names, the schema can use the `x-picker` JSON Schema extension:

```ts
{
  type: "object",
  required: ["userId"],
  properties: {
    userId: { type: "string", "x-picker": "user" },
    // renders a user typeahead; submits a user id string
    connectionId: { type: "string", "x-picker": "connection" }
    // renders a connection picker; submits a connection id string
  }
}
```

Supported picker types in v1: `user`, `connection`. Unknown picker values fall back to a plain typed input. Fields without `x-picker` render as typed inputs based on `type`. The schema is the contract; name-based heuristics are explicitly not used.

Used for: admin "Test connection" on a connection card, user "Rebuild profile" on `/profile`, admin-triggered "Rebuild profile for user X" from the admin panel.

### `registerCoalesced`

Responds to bursts of triggers by running once, after the burst settles.

```ts
function registerCoalesced(opts: {
  id: string;
  name: string;
  description?: string;
  debounceMs: number; // required
  maxWaitMs?: number; // default 60_000
  scopeKey: (input: unknown) => string;
  handler: (ctx: JobRunContext, triggerCount: number) => Promise<void>;
  timeoutSec?: number;
}): CoalescedJobHandle;

interface CoalescedJobHandle extends JobHandle {
  trigger(input: { scopeKey: string; [k: string]: unknown }): void;
  // fire-and-forget; returns synchronously
}
```

Semantics:

- `trigger()` is synchronous and fire-and-forget.
- Each trigger resets the debounce timer for its scope. After `debounceMs` of silence (or `maxWaitMs` from first trigger, whichever comes first), the handler fires once with the accumulated `triggerCount`.
- Triggers arriving during handler execution extend a follow-up run; no triggers are dropped.
- Different scope keys coalesce independently.
- Coalesced jobs are not directly triggerable from the admin UI (their purpose is debouncing). Admins wanting to force work use the triggerable job that publishes to the same destination.

Registration rejects duplicate IDs at startup. Re-registration on plugin update is explicit: the old handle is disposed first, then the new one registers.

## Logging

Every run captures structured logs to a bounded buffer and persists them into `job_runs.logs` at run completion (any terminal status). Purpose: debuggability from the admin UI without stdout access.

### Capture

`ctx.logger` is the entry point. Under the hood, the runner establishes an `AsyncLocalStorage` context at handler invocation. The host logger's sink checks for this context on every log call — if present, the log entry tees to both stdout (existing behavior) and an in-memory ring buffer for the run. If absent (logs outside any job), behavior is unchanged.

This means any code reachable from the handler logs into the run's buffer automatically — DB helpers, service calls, scrubbers, feature modules — without the handler passing the logger explicitly. Plugin handlers benefit the same way: `PluginContext.logger` wraps the host logger, so plugin-emitted logs land in the run's buffer.

### Entry shape

```ts
interface LogEntry {
  ts: number; // absolute unix millis (wall-clock)
  level: "debug" | "info" | "warn" | "error";
  msg: string;
  meta?: Record<string, unknown>; // structured fields; scrubbed
  row?: string; // populated for scheduled_per_row, if applicable
}
```

Storing absolute `ts` (not offset from start) keeps the data useful if a run's started-at is ever corrected or the UI wants to show wall-clock times alongside relative offsets. The UI computes relative offsets for display.

### Error object logging

`logger.error(msg, err)` where `err` is an `Error`: the runner's logger flattens `err.message`, `err.stack`, and `err.cause` (recursively) into `meta.error`. Avoids `[object Object]` in the buffer. Same treatment for `logger.warn(msg, err)`.

### Level filtering

Per-job configured log level gates what enters the buffer. Entries below the level are dropped at log time (not stored, not buffered). Default `info`. Admin override via `job_config.log_level`. Useful workflow: admin bumps a flaky job to `debug`, force-triggers, reviews logs, reverts to `info`.

Level filtering applies only to the run buffer. Stdout logs still honor the host-wide log level (unchanged). Admins bumping a job to `debug` does not flood stdout — only the captured buffer for runs of that job.

### Size cap and truncation

Ring buffer, 500KB per run. On overflow, oldest entries are dropped; a `{ truncated: N }` marker is recorded and surfaced in the UI. Entry size is measured post-scrub-and-serialize so the cap bounds actual storage.

### Scrubbing

Log entries pass through the same scrubber used by `error_records.context` before persistence. No new patterns; the scrubber is already pattern-based and covers the shapes that matter (credentials, tokens, email, phone). Scrub runs on `meta` objects and on `msg` strings.

### Persistence

On run completion (any terminal status: `succeeded`, `partial_failure`, `failed`, `skipped`, `timed_out`, `cancelled`), the buffer serializes to JSON and writes into `job_runs.logs`. No periodic flushes; process crash mid-run loses in-flight logs, which is acceptable because the error-management pipeline captures crashes separately through its own path.

### Retention

Logs live and die with the `job_runs` row. When a successful run is pruned (50-row cap per job), its logs go with it. Failed runs (and their logs) are retained indefinitely.

### Viewer permissions

Viewing logs requires `admin:jobs`. Users who triggered a feature job on themselves can see the run exists (status, duration, `result`) through whatever feature-specific surface exists — but not the captured logs. Logs are admin-only in v1; opening them to users is a future scope decision, not an oversight.

## Database schema

### `job_runs`

One row per run (including skips, timeouts, and cancellations). Pruning policy: last 50 successful runs per job retained; all non-successful runs retained indefinitely.

```
job_runs
├── id                      text PK                     (cuid2)
├── job_id                  text NOT NULL
├── scope_key               text                        (nullable; target of the work)
├── status                  text NOT NULL               ("succeeded" | "partial_failure" | "failed"
│                                                         | "skipped" | "timed_out" | "cancelled")
├── triggered_by            text NOT NULL               ("cron" | "admin" | "user" | "feature")
├── triggered_by_user_id    text FK → user.id           (nullable; acting principal)
├── started_at              integer NOT NULL            (unix millis)
├── finished_at             integer                     (nullable for in-progress)
├── duration_ms             integer                     (nullable for skipped/in-progress)
├── request_id              text NOT NULL               (correlates to error_records.request_id)
├── rows_total              integer                     (scheduled_per_row only)
├── rows_succeeded          integer                     (scheduled_per_row only)
├── rows_failed             integer                     (scheduled_per_row only)
├── error_record_id         text FK → error_records.id  (nullable)
├── result                  text                        (nullable; JSON, bounded ~4KB)
├── logs                    text                        (nullable; JSON, bounded ~500KB)
├── logs_truncated          integer                     (count of dropped entries; 0 if none)
├── coalesced_count         integer                     (coalesced only)
├── INDEX(job_id, started_at DESC)
├── INDEX(started_at DESC)
├── INDEX(status, started_at DESC)
├── INDEX(request_id)
├── INDEX(scope_key)                                    (supports "runs for user X" queries)
```

`scope_key` is indexed to support the admin surface's per-target filter. `logs` is a text column holding JSON; `logs_truncated` is a separate integer so the UI can warn without parsing the logs blob.

Pruning runs at the end of each successful run, deleting old successful rows beyond the cap for that `job_id`.

### `job_config`

Per-job operator overrides. Rows are created lazily — a job without a row runs with its code-declared schedule, enabled, at default log level.

```
job_config
├── job_id              text PK
├── enabled             integer NOT NULL DEFAULT 1
├── schedule_override   text                            (nullable)
├── log_level           text NOT NULL DEFAULT 'info'    ('debug' | 'info' | 'warn' | 'error')
├── updated_by          text FK → user.id
├── updated_at          integer NOT NULL
```

`schedule_override`, when non-null, replaces the code-declared schedule. The adapter re-registers the cron entry with the new schedule on update.

`log_level` gates entries entering the run buffer (see §Logging).

## HTTP API

All endpoints are Hono routes under `/api/jobs`.

### Admin endpoints (`admin:jobs`)

- `GET /api/jobs` — list all registered jobs. Returns an array of `JobHandle` including `name`, `description`, `adminTriggerable`, `userTriggerable`, `inputSchema`, `lastRun`, `nextRun`.
- `GET /api/jobs/:id` — per-job detail. Returns the `JobHandle` plus recent runs (default 20; `?limit=` up to 100). Supports `?scopeKey=` and `?status=` filters.
- `GET /api/jobs/:id/runs/:runId` — single run detail including `logs` and `logs_truncated`.
- `POST /api/jobs/:id/trigger` — admin trigger. Accepts **any** triggerable or `adminTriggerable` scheduled/scheduled_per_row job:
  - For `admin:jobs`-required triggerable jobs: body is the input.
  - For `feature`-scoped triggerable jobs: body is the input (including any scopeKey-producing field like a target user id). The feature's `check` is **not** invoked — `admin:jobs` is the authorization. `triggered_by_user_id` is the admin; `scope_key` is derived from input per the job's `scopeKey` function.
  - For `adminTriggerable: true` scheduled / scheduled_per_row jobs: body is empty (or ignored); runs the handler as if cron fired.
  - Returns `{ runId, result? }` (result only for triggerable). Returns `job.wrong_kind` if the job isn't admin-triggerable.
- `POST /api/jobs/:id/cancel` — set the abort signal. Returns immediately.
- `POST /api/jobs/:id/config` — update `job_config`. Body: `{ enabled?: boolean; scheduleOverride?: string | null; logLevel?: "debug" | "info" | "warn" | "error" }`. Returns the updated `JobHandle`.

### User-scoped endpoint (authenticated users)

- `POST /api/jobs/:id/trigger-user` — trigger a feature-scoped triggerable job. Body is the input. The feature's `check(userId, input)` runs before the handler; failure returns `job.forbidden`. `triggered_by_user_id` and `scope_key` are both the calling user (for self-serve flows where `scopeKey(input)` resolves to the caller's id, which is the feature's own responsibility to enforce via `check`). Returns `{ runId, result }`.

Only feature-scoped triggerable jobs are reachable from this endpoint. `admin:jobs` jobs return `job.forbidden`.

### Audit semantics

`triggered_by_user_id` is the acting principal. `scope_key` is the target of the work. For self-serve user triggers they match. For admin-triggered feature jobs they differ — this is the whole point. Both columns are indexed; the admin run history surfaces both.

### Errors

All endpoints return `UserFacingError` per the error-management doc. Job-specific codes added to `HOST_ERROR_CODES`:

| Code                  | When                                                   |
| --------------------- | ------------------------------------------------------ |
| `job.not_found`       | Job id not registered                                  |
| `job.already_running` | Same scope key (or scopeless) already running          |
| `job.disabled`        | `job_config.enabled = 0`                               |
| `job.bad_input`       | Input failed schema validation                         |
| `job.wrong_kind`      | Trigger on non-triggerable/admin-triggerable, etc.     |
| `job.forbidden`       | Feature `check` returned false, or admin-only via user |

English templates added to `locales/en/errors.json`.

Captured vs not captured: expected product-behavior errors are not captured. `job.forbidden`, `job.already_running`, `job.bad_input`, `job.disabled`, `job.not_found`, `job.wrong_kind` are all expected. Handler throws and timeouts are captured as `error` severity.

## Integration with the error-management pipeline

When a job run fails, the service:

1. Catches the exception from the handler (or detects timeout/abort).
2. Calls `captureError(err, { severity: "error", source: "cron" | "plugin", route: ` + "`job:${jobId}`" + `, userId: triggeredByUserId, pluginId: capture?.pluginId, context: { jobId, runId, kind, triggeredBy, scopeKey } })`.
3. Stores the returned `error_record_id` on the `job_runs` row.
4. Sets the `job_runs.status` per the rules above.
5. Writes the captured log buffer to `job_runs.logs`.

The admin drawer has a "View error" link deep-linking to `/admin/errors?requestId={run.request_id}`.

Request IDs propagate into and out of jobs:

- Jobs triggered by cron generate a fresh `requestId` at run start.
- Jobs triggered by admin or user API calls inherit the HTTP request's `requestId`.
- Jobs triggered by a feature propagate the caller's `requestId` into the coalesced trigger. When the coalesced handler eventually runs, it uses a fresh `requestId` but the triggering feature's `error_records` chain is still discoverable via the feature call's own request ID.

The scrubber runs over both `error_records.context` and the run's `logs` buffer before persistence.

## Admin surface at `/admin/jobs`

Permission: `admin:jobs`. Parallel to `/admin/errors` in structure.

- **Title:** "Jobs". **Subtitle:** "Background tasks running across the system."
- **Aggregate widget:** "`{n}` runs in last 24h, `{m}` failed" with a per-hour sparkline.
- **Filters:** kind, status, source (host / plugin / feature), enabled/disabled, date range, request ID, target user (scope key), free-text search on job id or name.
- **Job list table:** columns Name, ID, Kind, Last run, Enabled. Rows show `name` prominently with `id` as secondary text. Click opens the job detail page.
- **Job detail page:** `name`, `description`, kind, schedule (code-declared and override side by side), enable/disable toggle, schedule override input, log level selector, "Trigger now" button.
- **Trigger dialog:**
  - For admin-triggerable scheduled jobs: confirmation dialog, no input.
  - For admin-triggerable `scheduled_per_row`: confirmation dialog showing current row count ("this will process N items").
  - For triggerable jobs: form generated from `inputSchema`. Fields with `x-picker: "user"` render a user typeahead; `x-picker: "connection"` renders a connection picker. Other fields render as typed inputs per JSON Schema `type`.
- **Recent runs table (on detail page):** columns Timestamp, Status, Duration, Triggered by, **Target** (shows `scope_key`, formatted as a user display name when it resolves to a user id), Rows (for per-row). Rows clickable; opens a drawer.
- **Run detail drawer:** three tabs:
  - **Details:** status, timing, triggered by, target, input/result, linked error record (click → `/admin/errors?requestId=...`).
  - **Logs:** chronological log viewer with level filter. For `scheduled_per_row`, an additional row filter. Truncation banner at the top if `logs_truncated > 0`.
  - **Raw:** the full `job_runs` row as JSON (escape hatch for debugging).
- **Navigation badge:** count of failed runs in the last hour on the sidebar link.

## Migration from existing jobs

| Existing location                                          | Kind                  | Migration                                                                                                                                               |
| ---------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plugin runtime — `manifest.jobs[]` (global)                | `scheduled`           | Runtime wraps plugin handler with `PluginContext` builder and calls `registerScheduled` with `name` from manifest, `capture: { source: "plugin", ... }` |
| Plugin runtime — `manifest.jobs[]` (`perConnection: true`) | `scheduled_per_row`   | Row source = `service_connections` filtered by plugin; handler wrapper builds per-user context and invokes plugin handler                               |
| Host `pending_auth` sweep                                  | `scheduled`           | `name: "Pending auth cleanup"`; `adminTriggerable: true`                                                                                                |
| Host `plugin_store` expired-row sweep                      | `scheduled`           | `name: "Plugin store cleanup"`; `adminTriggerable: true`                                                                                                |
| Host `error_records` retention sweep                       | `scheduled`           | `name: "Error record retention"`; reads retention from app config                                                                                       |
| Daily preference rebuild (`PREFERENCE_DAILY_JOB_ID`)       | `scheduled_per_row`   | `name: "Daily preference rebuild"`; `adminTriggerable: true`                                                                                            |
| Admin "Test connection" endpoint                           | `registerTriggerable` | `name: "Test connection"`; `scopeKey: (input) => input.connectionId`; `requiredPermission: "admin:jobs"`; `inputSchema` uses `x-picker: "connection"`   |
| User "Test connection" on own connection                   | `registerTriggerable` | `name: "Test connection (user)"`; `requiredPermission: { kind: "feature", check }`; admin can now trigger on behalf of a user via the same job          |
| Feature preference rebuild (`feature.preference.rebuild`)  | `registerTriggerable` | `name: "Rebuild preference profile"`; `requiredPermission: { kind: "feature", check }`; admin gets user-picker form via `x-picker: "user"`              |

No behavior changes for the jobs themselves. Timing, semantics, credential-rebuild on plugin token refresh, status-update on plugin-job failure — all stay as documented.

A convention emerges from the migration: **jobs never call each other directly**. If job A's output should trigger job B, job A's handler calls `jobService.find("feature.b").trigger(...)`. No implicit chaining, no event bus.

The plugin architecture, media-service, and error-management docs each get a small revision note pointing at this doc.

## Layout

```
server/
├── jobs/
│   ├── index.ts                    # public API: registerScheduled, registerScheduledPerRow,
│   │                               # registerTriggerable, registerCoalesced, unregister
│   ├── registry.ts                 # in-memory JobHandle registry
│   ├── runner.ts                   # execution wrapper: concurrency, timing, abort, history
│   ├── run-logger.ts               # ALS context, tee sink, ring buffer, scrub + serialize
│   ├── scheduled.ts                # scheduled kind
│   ├── scheduled-per-row.ts        # scheduled_per_row kind (incl. per-row log tagging)
│   ├── triggerable.ts              # triggerable kind
│   ├── coalesced.ts                # coalesced kind + debounce timers
│   ├── croner-adapter.ts           # only file that imports croner
│   ├── history.ts                  # job_runs writes, pruning, queries
│   ├── config.ts                   # job_config reads/writes, schedule + log-level overrides
│   └── errors.ts                   # UserFacingError constructors for job.* codes
├── routes/
│   └── jobs.ts                     # Hono routes for /api/jobs/*
├── auth/
│   └── pending-auth.ts             # revised: registers via jobs/, no direct croner
├── plugin-runtime/
│   ├── registry.ts                 # revised: delegates job registration to jobs/
│   └── store.ts                    # revised: registers expired-row sweep via jobs/
├── errors/
│   └── retention.ts                # revised: registers sweep via jobs/
└── errors/
    └── codes.ts                    # revised: adds job.* codes to HOST_ERROR_CODES

docs/
└── job-service-guide.md            # for contributors: when to use which kind,
                                    # when to set adminTriggerable, x-picker conventions

locales/
└── en/
    └── errors.json                 # adds job.* English templates
```

Lint-level sanity checks:

- ESLint rule flagging direct `import { Cron } from "croner"` anywhere outside `server/jobs/croner-adapter.ts`.
- ESLint rule flagging registration calls missing `name` (catchable because `name` is required in the type, but a lint rule gives a clearer error at the call site if someone passes an untyped options object).

## Testing

### Per-kind unit tests

- **`scheduled`:** runs on tick; second tick during execution → `skipped`; handler throw → `failed` with captured error; timeout → `timed_out`; `adminTriggerable: true` → manual trigger succeeds when idle, returns `job.already_running` when cron tick is mid-run.
- **`scheduled_per_row`:** iterates sequentially; per-row error with `continueOnRowError: true` → run continues; `continueOnRowError: false` → stops at first error; run-level timeout; `adminTriggerable: true` + manual trigger records `triggered_by: "admin"` and runs same handler path.
- **`triggerable`:** scopeless → second concurrent trigger returns `job.already_running`; scoped → different scope keys run in parallel; schema validation failure returns `job.bad_input`; admin-triggers-feature-job path records admin as `triggered_by_user_id` and target as `scope_key`; user-triggers-feature-job path records caller as both; result serialized and truncated correctly.
- **`coalesced`:** rapid bursts within `debounceMs` → single handler invocation; `maxWaitMs` fires on steady trickle; triggers during execution extend; different scope keys coalesce independently.

### Logging

- Handler emits logs at `info`, `warn`, `error`, `debug` → entries at or above configured level appear in `job_runs.logs` after completion; `debug` dropped when level is `info`.
- Nested code (helper function that logs through the host logger) → entries appear in the run buffer without explicit logger passing (ALS context).
- `logger.error("boom", new Error("msg"))` → entry `meta.error` has `message`, `stack`, and flattened `cause`; no `[object Object]`.
- Buffer overflow (>500KB of entries) → oldest dropped, `logs_truncated` counter accurate.
- Scrubber applied: credential-shaped strings in `msg` and `meta` are redacted in the persisted `logs`.
- Log level override via `POST /api/jobs/:id/config` → next run's buffer reflects new level; stdout-level unchanged.
- Process crash mid-run: logs written so far are lost (documented); `job_runs.logs` is NULL for that run.

### Concurrency and lifecycle

- Two simultaneous scopeless triggers → second returns `job.already_running`.
- Cancel while running: signal fires; cooperative handler aborts, record written as `cancelled`; uncooperative handler runs to completion but record still `cancelled` with `duration_ms` populated; logs persisted either way.
- `unregister(jobId)`: subsequent triggers return `job.not_found`; cron entry removed; in-flight run completes normally.

### History retention

- Fixture with 60 succeeded + 3 failed → pruning keeps 50 latest succeeded + all 3 failed.
- `skipped` and `timed_out` retained indefinitely.
- Pruning removes `logs` with the pruned row.

### Error-management integration

- Handler throws → `captureError` called with correct source/route/context; `job_runs.error_record_id` populated; `/admin/errors` search by `request_id` returns the record.
- `scheduled_per_row` with two failing rows → two `error_records` entries sharing the same `request_id`; run's `error_record_id` is the first failure.
- Expected errors (`job.forbidden`, `job.already_running`, etc.) → not captured.

### API endpoints

- `admin:jobs`-required endpoints reject user tokens.
- `/trigger-user` rejects admin-only jobs; accepts feature-scoped jobs when `check` passes; rejects with `job.forbidden` when `check` fails.
- `/trigger` accepts feature-scoped jobs for admin callers (feature `check` bypassed); audit columns correct.
- `/trigger` on a scheduled job without `adminTriggerable: true` returns `job.wrong_kind`.
- `POST /api/jobs/:id/config` with invalid cron returns `job.bad_input`; with `logLevel: "debug"` updates the row and is reflected in the next run's captured logs.
- `inputSchema` with `x-picker: "user"` is echoed unchanged in the `GET /api/jobs/:id` response so the UI can render the typeahead.

### Migration integration

- Post-migration startup: every previously-existing job is registered via the service, each with a non-empty `name`.
- Lint rule catches direct `croner` imports outside the adapter.
- Plugin install: plugin-declared jobs appear in `/api/jobs` list with manifest-derived `name`.
- Plugin uninstall: those jobs removed from registry; their `job_runs` history remains per retention rules.

## Open questions / deferred

- **Distributed coordination for multi-instance.** V1 is single-instance-for-jobs. Postgres advisory-lock design (`pg_try_advisory_lock` keyed on a hash of job id + scope key) ready to pick up when multi-instance becomes a real requirement.
- **Parallelism within `scheduled_per_row`.** Sequential in v1. Bounded parallelism slots in non-breakingly via `runOpts?: { concurrency?: number }`.
- **Rate limiting on user-scoped triggers.** Per-user trigger buckets are a follow-up if spam becomes a hot path.
- **Typed run results for `triggerable`.** Generic at registration; runtime serialization is `unknown`. Callers typecast.
- **Automatic retry on failure.** Explicitly deferred. Handlers own retry logic. Uniform `retry?: { attempts; backoffMs }` is a non-breaking addition later.
- **Schedule visualizer in the admin UI.** Admins set cron expressions directly with croner validation. Visual cron builder is a UX enhancement.
- **Job dependencies / DAGs.** Not supported. If X depends on Y, X's handler awaits Y's trigger explicitly.
- **Live log tailing.** Watching logs stream for a long-running triggerable job requires SSE or WebSocket. Deferred with the broader streaming work. V1 logs are viewable after run completion only.
- **User-visible logs for self-triggered feature jobs.** V1 restricts log viewing to `admin:jobs`. Opening a per-feature subset of logs to the triggering user is a future scope decision.
- **Streaming run output.** Same as logs: result is a single final payload in v1.
- **Additional `x-picker` types.** V1 ships `user` and `connection`. New pickers added as jobs demand them.
