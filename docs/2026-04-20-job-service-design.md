# Job Service

**Status:** Draft for review (revised)
**Date:** 2026-04-20 (revised 2026-04-21)
**Author:** Omid Astaraki
**Depends on:** `2026-04-19-plugin-architecture-design.md`, `2026-04-19-media-service-design.md`, `2026-04-19-error-management-design.md`
**Revises (on merge):** Plugin architecture doc §Lifecycle (token refresh & scheduled work); error-management doc §Capture surfaces (cron wrapper); media-service doc §Testing (where jobs referenced)

## Summary

Single host-side service owns registration, execution, & observability of every background job. Four kinds cover all shapes of work from existing specs: `scheduled` (handler fires on cron), `scheduled_per_row` (handler iterates rows from query), `triggerable` (handler runs on explicit API call, optionally also cron), `coalesced` (handler runs debounced after burst of triggers). Each kind → own focused registration API.

Every registered job carries human-readable `name` & optional `description` surfaced in admin UI, plus per-run structured logs viewable in admin drawer. Service integrates with error-management pipeline — failed runs captured, scrubbed, correlated via shared `request_id`. Admin surface at `/admin/jobs` mirrors `/admin/errors` — list, filter, detail drawer, one-click jump from failed run → full error record. Admins trigger any job, including feature-scoped jobs on behalf of specific user (audit trail captures acting admin & target user). Users trigger feature-scoped jobs on own data through separate endpoint gated by feature-level permissions.

All existing jobs migrate to service, no behavior change. New jobs register through service API, not direct `croner`.

## Goals

- One place to register & observe background jobs (host-internal, plugin-declared, feature-triggered).
- Distinct APIs for four job shapes — no caller re-implements iteration, debouncing, concurrency control.
- Human-readable `name`, `description` on every job — admin UI operationally useful.
- Structured run history with retention; failures prominent; storage bounded for successes.
- Per-run structured logs captured & persisted — admins debug failures without stdout access.
- Admin surface for ops: enable/disable, re-schedule, trigger on demand (including scheduled jobs outside cron window & feature-scoped jobs against chosen target user), cancel, inspect runs & linked errors, review logs.
- User-scoped triggering for features like "Rebuild profile" without granting `admin:jobs`.
- Error-management integration — failed runs → `error_records` correlated by `request_id`.
- Migrate existing ad-hoc job registrations, no behavior change.

## Non-goals

- ⊥ distributed coordination for multi-instance. V1 single-instance for jobs; documented constraint. Postgres advisory locks natural follow-up.
- ⊥ parallelism across rows within `scheduled_per_row`. Sequential in v1.
- ⊥ built-in retry-on-failure. Handlers own retry logic.
- ⊥ cross-job dependencies or DAGs. Job that depends on another calls other's trigger explicitly.
- ⊥ event bus or pub/sub. Jobs ⊥ communicate through implicit channels.
- ⊥ worker isolation beyond existing plugin sandbox. Host-internal jobs run in host process.
- ⊥ live log tailing (SSE or WebSocket). Logs viewable after run completes; deferred with broader streaming work.

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

Three concerns:

- **Registration & lifecycle.** Four registration fns, one per kind. All jobs register through service; nothing touches `croner` directly except adapter. Plugin jobs register through plugin runtime's install/enable path — wraps plugin handler in `PluginContext` builder → calls appropriate registration fn. On plugin disable/uninstall, runtime calls `unregister(jobId)`.
- **Execution.** Thin runner wraps each handler invocation: concurrency control (in-memory `running` set keyed on `jobId` | `jobId:scopeKey`), timing, logging (§Logging), timeout enforcement, abort-signal propagation, error capture, `job_runs` writes. Each kind → own small module implementing dispatch semantics on top of runner.
- **Admin API.** Read & write endpoints for `/admin/jobs` & feature-driven user triggers. Permission split: `admin:jobs` for full admin surface; feature-level permission checks for user-scoped triggers. Admins trigger feature-scoped jobs through admin endpoint (§HTTP API for audit details).

Service lives at `server/jobs/`. Peer of `server/media-service/`, `server/mcp/`, `server/plugin-runtime/`, `server/errors/`. Deps on peers: only `server/errors/` (for `captureError`). `MediaService` & plugin runtime depend on it, ⊥ reverse.

## Shared types

Every kind returns `JobHandle` for introspect/manipulate at runtime:

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

`name`, `description`, `inputSchema` code-declared at registration, ⊥ persisted. `name` ! all kinds; `description` ? encouraged.

`adminTriggerable` & `userTriggerable` replace previous single `adminTriggerable` flag:

- `adminTriggerable: true` → admin triggers job without specifying target user (admin-owned jobs | scheduled jobs with `adminTriggerable: true` opt-in).
- `userTriggerable: true` → job is feature-scoped — admin still triggers, but ! supply target user context; non-admin users reach only via `/trigger-user`.

Admin UI uses `adminTriggerable || userTriggerable` to show trigger button; flag identity → decides form shape.

Every handler receives `JobRunContext`:

```ts
interface JobRunContext {
  runId: string; // cuid2, corresponds to job_runs.id
  triggeredBy: "cron" | "admin" | "user" | "feature";
  triggeredByUserId?: string; // acting principal (admin id when admin triggers)
  scopeKey?: string; // target of run (e.g. target user id)
  requestId: string; // from AsyncLocalStorage or freshly generated
  logger: Logger; // tees to stdout + run log buffer (see §Logging)
  abortSignal: AbortSignal; // honored at handler-chosen break points
}
```

`triggeredByUserId` = acting principal (admin when admin triggers on behalf of user). `scopeKey` = target of work. For admin-triggered feature jobs these differ; for user-triggered jobs they match.

`abortSignal` = how "cancel" works — service sets abort on cancel request; handlers check at natural break points. Handlers that don't check run to completion; fine for short-lived jobs.

`requestId` threaded through to `captureError` & `logger` — failed runs correlate with error-management pipeline exactly as MCP calls & Hono handlers do. When job triggered by feature, trigger call propagates caller's `request_id` into job's run context.

## Job kinds

All four kinds share `id`, `name`, `description?` at registration.

### `registerScheduled`

Simplest kind. Fires on cron tick, no iteration.

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

- On cron tick: previous run active → tick written as `skipped` in `job_runs`, nothing else.
- Otherwise: handler runs inside runner wrapper. Success | failure recorded.
- `adminTriggerable: true` → exposes job at `POST /api/jobs/:id/trigger` with no input (runs handler as if cron fired, `triggeredBy: "admin"`). Skip-if-running applies — cron tick mid-run → manual trigger returns `job.already_running`.
- `capture` controls how failures labeled in error pipeline: host-internal → `{ source: "cron" }`; plugin jobs → `{ source: "plugin", pluginId }`.

Used for: `pending_auth` sweep, `plugin_store` expired-row sweep, `error_records` retention sweep, plugin-global scheduled jobs.

### `registerScheduledPerRow`

Iterates row source each tick; handler called once per row sequentially.

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

- Skip-if-running at job level; second tick | manual trigger during iteration → `skipped` | `job.already_running`.
- `rowSource()` called once at run start; result iterates sequentially.
- Per-row errors captured as individual `error_records` entries; run continues unless `continueOnRowError: false`.
- `adminTriggerable: true` → force-run enabled. Admin UI shows confirmation dialog with current row count ("this will process N items") before firing.
- `job_runs` records aggregate stats: `rows_total`, `rows_succeeded`, `rows_failed`. Run status: all succeeded → `succeeded`; some failed → `partial_failure`; all failed → `failed`; run timeout → `timed_out`; cancel → `cancelled`.
- First row failure's `error_record_id` stored on `job_runs` row; all per-row failures share run's `request_id`.
- Per-row context: each row's identifier (best-effort stringified — row PK if present) tagged onto all log entries during that row's handler invocation → log viewer can filter by row.

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

- Without `scopeKey`: skip-if-running like `scheduled` (concurrent triggers → `job.already_running`).
- With `scopeKey`: triggers with different scope keys run in parallel; same scope key + already running → `job.already_running`.
- `inputSchema` validated before handler invocation; failure → `job.bad_input` before handler touched.
- `requiredPermission` gates **user** path (`/trigger-user`). Both values allow **admin** path (`/trigger`):
  - `admin:jobs` → admin-only everywhere. Reachable only via `/trigger`.
  - `{ kind: "feature", check }` → reachable by users via `/trigger-user` (feature's `check` gates access) **and** by admins via `/trigger` (`admin:jobs` token = authorization; feature check bypassed, but admin ! supply input including any `scopeKey`-producing field).
- `handler` returns value; serialized into `job_runs.result` (JSON, truncated at ~4KB with warning logged on truncation) & returned to caller.

**`inputSchema` annotations for admin form:** admin UI renders form from `inputSchema` when triggering. Guide form without string-matching field names via `x-picker` JSON Schema extension:

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

Supported picker types in v1: `user`, `connection`. Unknown picker values → plain typed input. Fields without `x-picker` → typed inputs based on `type`. Schema = contract; name-based heuristics ⊥ used.

Used for: admin "Test connection" on connection card, user "Rebuild profile" on `/profile`, admin-triggered "Rebuild profile for user X" from admin panel.

### `registerCoalesced`

Responds to bursts of triggers by running once, after burst settles.

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

- `trigger()` synchronous & fire-and-forget.
- Each trigger resets debounce timer for its scope. After `debounceMs` silence (| `maxWaitMs` from first trigger, whichever first) → handler fires once with accumulated `triggerCount`.
- Triggers arriving during handler execution extend follow-up run; ⊥ triggers dropped.
- Different scope keys coalesce independently.
- ⊥ directly triggerable from admin UI (purpose = debouncing). Admins wanting force-run use triggerable job publishing to same destination.

Registration rejects duplicate IDs at startup. Re-registration on plugin update: old handle disposed first, new one registers.

## Logging

Every run captures structured logs to bounded buffer & persists into `job_runs.logs` at run completion (any terminal status). Purpose: debuggability from admin UI without stdout access.

### Capture

`ctx.logger` = entry point. Runner establishes `AsyncLocalStorage` context at handler invocation. Host logger's sink checks for this context on every log call — present → tees to stdout (existing behavior) & in-memory ring buffer for run. Absent (logs outside job) → behavior unchanged.

∴ any code reachable from handler logs into run's buffer automatically — DB helpers, service calls, scrubbers, feature modules — without handler passing logger explicitly. Plugin handlers benefit same way: `PluginContext.logger` wraps host logger → plugin-emitted logs land in run's buffer.

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

Absolute `ts` (not offset from start) keeps data useful if run's started-at ever corrected | UI wants wall-clock times alongside relative offsets. UI computes relative offsets for display.

### Error object logging

`logger.error(msg, err)` where `err` is `Error`: runner's logger flattens `err.message`, `err.stack`, `err.cause` (recursively) into `meta.error`. ⊥ `[object Object]` in buffer. Same treatment for `logger.warn(msg, err)`.

### Level filtering

Per-job configured log level gates what enters buffer. Entries below level dropped at log time (⊥ stored, ⊥ buffered). Default `info`. Admin override via `job_config.log_level`. Useful: admin bumps flaky job to `debug`, force-triggers, reviews logs, reverts to `info`.

Level filtering applies only to run buffer. Stdout logs still honor host-wide log level (unchanged). Admin bumping job to `debug` ⊥ floods stdout — only captured buffer for runs of that job.

### Size cap and truncation

Ring buffer, 500KB per run. On overflow, oldest entries dropped; `{ truncated: N }` marker recorded & surfaced in UI. Entry size measured post-scrub-and-serialize → cap bounds actual storage.

### Scrubbing

Log entries pass through same scrubber used by `error_records.context` before persistence. ⊥ new patterns; scrubber already pattern-based, covers shapes that matter (credentials, tokens, email, phone). Scrub runs on `meta` objects & `msg` strings.

### Persistence

On run completion (any terminal status: `succeeded`, `partial_failure`, `failed`, `skipped`, `timed_out`, `cancelled`), buffer serializes to JSON → writes into `job_runs.logs`. ⊥ periodic flushes; process crash mid-run loses in-flight logs (acceptable — error-management pipeline captures crashes via own path).

### Retention

Logs live & die with `job_runs` row. Successful run pruned (50-row cap per job) → logs go with it. Failed runs (& logs) retained indefinitely.

### Viewer permissions

Viewing logs ! `admin:jobs`. Users who triggered feature job on themselves see run exists (status, duration, `result`) through feature-specific surface — ⊥ captured logs. Logs admin-only in v1; opening to users = future scope decision, ⊥ oversight.

## Database schema

### `job_runs`

One row per run (including skips, timeouts, cancellations). Pruning: last 50 successful runs per job retained; all non-successful retained indefinitely.

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

`scope_key` indexed to support admin surface's per-target filter. `logs` = text column holding JSON; `logs_truncated` = separate integer → UI warns without parsing logs blob.

Pruning runs at end of each successful run, deleting old successful rows beyond cap for that `job_id`.

### `job_config`

Per-job operator overrides. Rows created lazily — job without row runs with code-declared schedule, enabled, at default log level.

```
job_config
├── job_id              text PK
├── enabled             integer NOT NULL DEFAULT 1
├── schedule_override   text                            (nullable)
├── log_level           text NOT NULL DEFAULT 'info'    ('debug' | 'info' | 'warn' | 'error')
├── updated_by          text FK → user.id
├── updated_at          integer NOT NULL
```

`schedule_override`, when non-null, replaces code-declared schedule. Adapter re-registers cron entry with new schedule on update.

`log_level` gates entries entering run buffer (§Logging).

## HTTP API

All endpoints Hono routes under `/api/jobs`.

### Admin endpoints (`admin:jobs`)

- `GET /api/jobs` — list all registered jobs. Returns array of `JobHandle` including `name`, `description`, `adminTriggerable`, `userTriggerable`, `inputSchema`, `lastRun`, `nextRun`.
- `GET /api/jobs/:id` — per-job detail. Returns `JobHandle` plus recent runs (default 20; `?limit=` up to 100). Supports `?scopeKey=` & `?status=` filters.
- `GET /api/jobs/:id/runs/:runId` — single run detail including `logs` & `logs_truncated`.
- `POST /api/jobs/:id/trigger` — admin trigger. Accepts **any** triggerable | `adminTriggerable` scheduled/scheduled_per_row job:
  - `admin:jobs`-required triggerable: body = input.
  - `feature`-scoped triggerable: body = input (including any scopeKey-producing field like target user id). Feature's `check` ⊥ invoked — `admin:jobs` = authorization. `triggered_by_user_id` = admin; `scope_key` derived from input per job's `scopeKey` fn.
  - `adminTriggerable: true` scheduled | scheduled_per_row: body empty (| ignored); runs handler as if cron fired.
  - Returns `{ runId, result? }` (result only for triggerable). Returns `job.wrong_kind` if job ⊥ admin-triggerable.
- `POST /api/jobs/:id/cancel` — set abort signal. Returns immediately.
- `POST /api/jobs/:id/config` — update `job_config`. Body: `{ enabled?: boolean; scheduleOverride?: string | null; logLevel?: "debug" | "info" | "warn" | "error" }`. Returns updated `JobHandle`.

### User-scoped endpoint (authenticated users)

- `POST /api/jobs/:id/trigger-user` — trigger feature-scoped triggerable job. Body = input. Feature's `check(userId, input)` runs before handler; failure → `job.forbidden`. `triggered_by_user_id` & `scope_key` both = calling user (for self-serve flows where `scopeKey(input)` resolves to caller's id — feature's responsibility to enforce via `check`). Returns `{ runId, result }`.

Only feature-scoped triggerable jobs reachable from this endpoint. `admin:jobs` jobs → `job.forbidden`.

### Audit semantics

`triggered_by_user_id` = acting principal. `scope_key` = target of work. Self-serve user triggers → they match. Admin-triggered feature jobs → they differ; that's the point. Both columns indexed; admin run history surfaces both.

### Errors

All endpoints return `UserFacingError` per error-management doc. Job-specific codes added to `HOST_ERROR_CODES`:

| Code                  | When                                                   |
| --------------------- | ------------------------------------------------------ |
| `job.not_found`       | Job id not registered                                  |
| `job.already_running` | Same scope key (or scopeless) already running          |
| `job.disabled`        | `job_config.enabled = 0`                               |
| `job.bad_input`       | Input failed schema validation                         |
| `job.wrong_kind`      | Trigger on non-triggerable/admin-triggerable, etc.     |
| `job.forbidden`       | Feature `check` returned false, or admin-only via user |

English templates added to `locales/en/errors.json`.

Captured vs not: expected product-behavior errors ⊥ captured. `job.forbidden`, `job.already_running`, `job.bad_input`, `job.disabled`, `job.not_found`, `job.wrong_kind` all expected. Handler throws & timeouts captured as `error` severity.

## Integration with the error-management pipeline

When job run fails, service:

1. Catches exception from handler (| detects timeout/abort).
2. Calls `captureError(err, { severity: "error", source: "cron" | "plugin", route: ` + "`job:${jobId}`" + `, userId: triggeredByUserId, pluginId: capture?.pluginId, context: { jobId, runId, kind, triggeredBy, scopeKey } })`.
3. Stores returned `error_record_id` on `job_runs` row.
4. Sets `job_runs.status` per rules above.
5. Writes captured log buffer to `job_runs.logs`.

Admin drawer has "View error" link deep-linking to `/admin/errors?requestId={run.request_id}`.

Request IDs propagate into & out of jobs:

- Jobs triggered by cron → fresh `requestId` at run start.
- Jobs triggered by admin | user API calls → inherit HTTP request's `requestId`.
- Jobs triggered by feature → propagate caller's `requestId` into coalesced trigger. When coalesced handler eventually runs → uses fresh `requestId`, but triggering feature's `error_records` chain discoverable via feature call's own request ID.

Scrubber runs over both `error_records.context` & run's `logs` buffer before persistence.

## Admin surface at `/admin/jobs`

Permission: `admin:jobs`. Parallel to `/admin/errors` in structure.

- **Title:** "Jobs". **Subtitle:** "Background tasks running across the system."
- **Aggregate widget:** "`{n}` runs in last 24h, `{m}` failed" with per-hour sparkline.
- **Filters:** kind, status, source (host | plugin | feature), enabled/disabled, date range, request ID, target user (scope key), free-text search on job id | name.
- **Job list table:** columns Name, ID, Kind, Last run, Enabled. Rows show `name` prominently with `id` as secondary text. Click → job detail page.
- **Job detail page:** `name`, `description`, kind, schedule (code-declared & override side by side), enable/disable toggle, schedule override input, log level selector, "Trigger now" button.
- **Trigger dialog:**
  - Admin-triggerable scheduled: confirmation dialog, no input.
  - Admin-triggerable `scheduled_per_row`: confirmation dialog showing current row count ("this will process N items").
  - Triggerable jobs: form generated from `inputSchema`. Fields with `x-picker: "user"` → user typeahead; `x-picker: "connection"` → connection picker. Other fields → typed inputs per JSON Schema `type`.
- **Recent runs table (on detail page):** columns Timestamp, Status, Duration, Triggered by, **Target** (`scope_key`, formatted as user display name when resolves to user id), Rows (for per-row). Rows clickable → opens drawer.
- **Run detail drawer:** three tabs:
  - **Details:** status, timing, triggered by, target, input/result, linked error record (click → `/admin/errors?requestId=...`).
  - **Logs:** chronological log viewer with level filter. `scheduled_per_row` → additional row filter. Truncation banner at top if `logs_truncated > 0`.
  - **Raw:** full `job_runs` row as JSON (escape hatch for debugging).
- **Navigation badge:** count of failed runs in last hour on sidebar link.

## Migration from existing jobs

| Existing location                                          | Kind                  | Migration                                                                                                                                               |
| ---------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plugin runtime — `manifest.jobs[]` (global)                | `scheduled`           | Runtime wraps plugin handler with `PluginContext` builder, calls `registerScheduled` with `name` from manifest, `capture: { source: "plugin", ... }` |
| Plugin runtime — `manifest.jobs[]` (`perConnection: true`) | `scheduled_per_row`   | Row source = `service_connections` filtered by plugin; handler wrapper builds per-user context & invokes plugin handler                               |
| Host `pending_auth` sweep                                  | `scheduled`           | `name: "Pending auth cleanup"`; `adminTriggerable: true`                                                                                                |
| Host `plugin_store` expired-row sweep                      | `scheduled`           | `name: "Plugin store cleanup"`; `adminTriggerable: true`                                                                                                |
| Host `error_records` retention sweep                       | `scheduled`           | `name: "Error record retention"`; reads retention from app config                                                                                       |
| Daily preference rebuild (`PREFERENCE_DAILY_JOB_ID`)       | `scheduled_per_row`   | `name: "Daily preference rebuild"`; `adminTriggerable: true`                                                                                            |
| Admin "Test connection" endpoint                           | `registerTriggerable` | `name: "Test connection"`; `scopeKey: (input) => input.connectionId`; `requiredPermission: "admin:jobs"`; `inputSchema` uses `x-picker: "connection"`   |
| User "Test connection" on own connection                   | `registerTriggerable` | `name: "Test connection (user)"`; `requiredPermission: { kind: "feature", check }`; admin triggers on behalf of user via same job          |
| Feature preference rebuild (`feature.preference.rebuild`)  | `registerTriggerable` | `name: "Rebuild preference profile"`; `requiredPermission: { kind: "feature", check }`; admin gets user-picker form via `x-picker: "user"`              |

⊥ behavior changes for jobs themselves. Timing, semantics, credential-rebuild on plugin token refresh, status-update on plugin-job failure — all stay as documented.

Convention from migration: **jobs ⊥ call each other directly**. Job A's output should trigger job B → job A's handler calls `jobService.find("feature.b").trigger(...)`. ⊥ implicit chaining, ⊥ event bus.

Plugin architecture, media-service, & error-management docs each get small revision note pointing at this doc.

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

- ESLint rule flags direct `import { Cron } from "croner"` anywhere outside `server/jobs/croner-adapter.ts`.
- ESLint rule flags registration calls missing `name` (catchable because `name` ! in type, but lint rule gives clearer error at call site if someone passes untyped options object).

## Testing

### Per-kind unit tests

- **`scheduled`:** runs on tick; second tick during execution → `skipped`; handler throw → `failed` with captured error; timeout → `timed_out`; `adminTriggerable: true` → manual trigger succeeds when idle, returns `job.already_running` when cron tick mid-run.
- **`scheduled_per_row`:** iterates sequentially; per-row error with `continueOnRowError: true` → run continues; `continueOnRowError: false` → stops at first error; run-level timeout; `adminTriggerable: true` + manual trigger records `triggered_by: "admin"` & runs same handler path.
- **`triggerable`:** scopeless → second concurrent trigger returns `job.already_running`; scoped → different scope keys run in parallel; schema validation failure → `job.bad_input`; admin-triggers-feature-job path records admin as `triggered_by_user_id` & target as `scope_key`; user-triggers-feature-job path records caller as both; result serialized & truncated correctly.
- **`coalesced`:** rapid bursts within `debounceMs` → single handler invocation; `maxWaitMs` fires on steady trickle; triggers during execution extend; different scope keys coalesce independently.

### Logging

- Handler emits logs at `info`, `warn`, `error`, `debug` → entries at | above configured level appear in `job_runs.logs` after completion; `debug` dropped when level is `info`.
- Nested code (helper fn that logs through host logger) → entries appear in run buffer without explicit logger passing (ALS context).
- `logger.error("boom", new Error("msg"))` → entry `meta.error` has `message`, `stack`, & flattened `cause`; ⊥ `[object Object]`.
- Buffer overflow (>500KB of entries) → oldest dropped, `logs_truncated` counter accurate.
- Scrubber applied: credential-shaped strings in `msg` & `meta` redacted in persisted `logs`.
- Log level override via `POST /api/jobs/:id/config` → next run's buffer reflects new level; stdout-level unchanged.
- Process crash mid-run: logs written so far lost (documented); `job_runs.logs` = NULL for that run.

### Concurrency and lifecycle

- Two simultaneous scopeless triggers → second returns `job.already_running`.
- Cancel while running: signal fires; cooperative handler aborts, record written as `cancelled`; uncooperative handler runs to completion but record still `cancelled` with `duration_ms` populated; logs persisted either way.
- `unregister(jobId)`: subsequent triggers → `job.not_found`; cron entry removed; in-flight run completes normally.

### History retention

- Fixture with 60 succeeded + 3 failed → pruning keeps 50 latest succeeded + all 3 failed.
- `skipped` & `timed_out` retained indefinitely.
- Pruning removes `logs` with pruned row.

### Error-management integration

- Handler throws → `captureError` called with correct source/route/context; `job_runs.error_record_id` populated; `/admin/errors` search by `request_id` returns record.
- `scheduled_per_row` with two failing rows → two `error_records` entries sharing same `request_id`; run's `error_record_id` = first failure.
- Expected errors (`job.forbidden`, `job.already_running`, etc.) → ⊥ captured.

### API endpoints

- `admin:jobs`-required endpoints reject user tokens.
- `/trigger-user` rejects admin-only jobs; accepts feature-scoped jobs when `check` passes; rejects with `job.forbidden` when `check` fails.
- `/trigger` accepts feature-scoped jobs for admin callers (feature `check` bypassed); audit columns correct.
- `/trigger` on scheduled job without `adminTriggerable: true` → `job.wrong_kind`.
- `POST /api/jobs/:id/config` with invalid cron → `job.bad_input`; with `logLevel: "debug"` → updates row & reflected in next run's captured logs.
- `inputSchema` with `x-picker: "user"` echoed unchanged in `GET /api/jobs/:id` response → UI renders typeahead.

### Migration integration

- Post-migration startup: every previously-existing job registered via service, each with non-empty `name`.
- Lint rule catches direct `croner` imports outside adapter.
- Plugin install: plugin-declared jobs appear in `/api/jobs` list with manifest-derived `name`.
- Plugin uninstall: those jobs removed from registry; `job_runs` history remains per retention rules.

## Open questions / deferred

- **Distributed coordination for multi-instance.** V1 single-instance-for-jobs. Postgres advisory-lock design (`pg_try_advisory_lock` keyed on hash of job id + scope key) ready when multi-instance real requirement.
- **Parallelism within `scheduled_per_row`.** Sequential in v1. Bounded parallelism slots in non-breakingly via `runOpts?: { concurrency?: number }`.
- **Rate limiting on user-scoped triggers.** Per-user trigger buckets = follow-up if spam hot path.
- **Typed run results for `triggerable`.** Generic at registration; runtime serialization = `unknown`. Callers typecast.
- **Automatic retry on failure.** Explicitly deferred. Handlers own retry logic. Uniform `retry?: { attempts; backoffMs }` = non-breaking addition later.
- **Schedule visualizer in admin UI.** Admins set cron expressions directly with croner validation. Visual cron builder = UX enhancement.
- **Job dependencies / DAGs.** ⊥ supported. X depends on Y → X's handler awaits Y's trigger explicitly.
- **Live log tailing.** Watching logs stream for long-running triggerable job → SSE | WebSocket needed. Deferred with broader streaming work. V1 logs viewable after run completion only.
- **User-visible logs for self-triggered feature jobs.** V1 restricts log viewing to `admin:jobs`. Opening per-feature subset to triggering user = future scope decision.
- **Streaming run output.** Same as logs: result = single final payload in v1.
- **Additional `x-picker` types.** V1 ships `user` & `connection`. New pickers added as jobs demand.
