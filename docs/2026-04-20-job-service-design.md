# Job Service

**Status:** Draft for review
**Date:** 2026-04-20
**Author:** Omid Astaraki
**Depends on:** `2026-04-19-plugin-architecture-design.md`, `2026-04-19-media-service-design.md`, `2026-04-19-error-management-design.md`
**Revises (on merge):** Plugin architecture doc §Lifecycle (token refresh and scheduled work); error-management doc §Capture surfaces (cron wrapper); media-service doc §Testing (where jobs are referenced)

## Summary

A single host-side service that owns the registration, execution, and observability of every background job in the system. Four job kinds cover the shapes of work that have been showing up independently across the existing specs: `scheduled` (a handler fires on cron), `scheduled_per_row` (a handler iterates rows from a query), `triggerable` (a handler runs on explicit API call, optionally also on cron), and `coalesced` (a handler runs debounced after a burst of triggers). Each kind has its own focused registration API.

The service integrates with the existing error-management pipeline so failed runs are captured, scrubbed, and correlated with other errors via the shared request ID. An admin surface at `/admin/jobs` mirrors the `/admin/errors` page — list, filter, detail drawer, one-click jump from a failed run to its full error record. Users can additionally trigger feature-scoped jobs on their own data (e.g. "Rebuild my profile," "Test this connection of mine") through a separate endpoint that checks feature-level permissions.

Every existing job in the codebase migrates to this service with no behavior change — the wiring just flows through one place. New jobs register through the service's API rather than directly through `croner`.

## Goals

- One place to register and observe background jobs, regardless of origin (host-internal, plugin-declared, feature-triggered).
- Distinct APIs for the four job shapes we actually have, so callers don't re-implement iteration, debouncing, or concurrency control.
- Structured run history with retention that surfaces failures prominently and bounds storage for successes.
- Admin surface that enables operations: enable/disable, re-schedule, trigger on demand, cancel, inspect recent runs and linked errors.
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
                  │  • trigger   (admin path)  │  (admin:jobs, admin-scoped jobs)
                  │  • trigger-user            │  (feature permission check)
                  │  • cancel, config          │  (admin:jobs)
                  └────────────────────────────┘
```

The service has three concerns:

- **Registration and lifecycle.** Four registration functions, one per kind. All jobs register through the service; nothing touches `croner` directly except the adapter. Plugin jobs register through the plugin runtime's install/enable path, which wraps the plugin's handler in a `PluginContext` builder and calls the appropriate registration function. On plugin disable/uninstall, the runtime calls `unregister(jobId)`.
- **Execution.** A thin runner wraps each handler invocation with: concurrency control (in-memory `running` set keyed on `jobId` or `jobId:scopeKey`), timing, logging, timeout enforcement, abort-signal propagation, error capture, and `job_runs` writes. Each kind has its own small module implementing its specific dispatch semantics on top of the runner.
- **Admin API.** Read and write endpoints for the `/admin/jobs` page and for feature-driven triggers. Permission split: `admin:jobs` for the full surface, feature-level permission checks for user-scoped triggers.

The service lives at `server/jobs/` and is a peer of `server/media-service/`, `server/mcp/`, `server/plugin-runtime/`, and `server/errors/`. It has no dependencies on those peers beyond `server/errors/` (for `captureError`). `MediaService` and the plugin runtime depend on it, not the other way around.

## Shared types

Every kind returns a `JobHandle` used to introspect or manipulate the job at runtime:

```ts
interface JobHandle {
  id: string;
  kind: "scheduled" | "scheduled_per_row" | "triggerable" | "coalesced";
  enabled: boolean;
  schedule?: string; // cron expression, for scheduled kinds
  lastRun?: JobRun;
  nextRun?: Date; // for scheduled kinds; undefined for triggerable
}
```

Every handler receives a `JobRunContext`:

```ts
interface JobRunContext {
  runId: string; // cuid2, corresponds to job_runs.id
  triggeredBy: "cron" | "admin" | "user" | "feature";
  triggeredByUserId?: string;
  requestId: string; // from AsyncLocalStorage or freshly generated
  logger: Logger; // tagged with job id, run id, request id
  abortSignal: AbortSignal; // honored at handler-chosen break points
}
```

The `abortSignal` is how the "cancel" button works — the job service sets abort when a cancel is requested; handlers check it at natural break points (between loop iterations, between awaits). Handlers that don't check run to completion, which is fine for short-lived jobs.

`requestId` is threaded through to `captureError` and `logger` so failed runs correlate with the error-management pipeline exactly as MCP calls and Hono handlers do. When a job is triggered by a feature (e.g. `ent_feedback` triggers a coalesced profile update), the trigger call propagates the caller's request ID into the job's run context.

## Job kinds

### `registerScheduled`

The simplest kind. Fires on a cron tick with no iteration.

```ts
function registerScheduled(opts: {
  id: string; // globally unique
  schedule: string; // cron expression (croner syntax)
  handler: (ctx: JobRunContext) => Promise<void>;
  timeoutSec?: number; // default 300
  capture?: { source?: "cron" | "plugin"; pluginId?: string };
  // defaults to { source: "cron" }
}): JobHandle;
```

Semantics:

- On cron tick: if a previous run is active, the tick is written as `skipped` in `job_runs` and nothing else happens.
- Otherwise, the handler runs inside the runner wrapper. Success or failure is recorded.
- `capture` controls how failures are labeled in the error pipeline: host-internal jobs use `{ source: "cron" }`; plugin jobs pass `{ source: "plugin", pluginId }` so the error record correlates to the plugin.

Used for: `pending_auth` sweep, `plugin_store` expired-row sweep, `error_records` retention sweep, plugin-global scheduled jobs (`manifest.jobs[]` without `perConnection`).

### `registerScheduledPerRow`

Iterates a row source each tick; handler is called once per row sequentially.

```ts
function registerScheduledPerRow<TRow>(opts: {
  id: string;
  schedule: string;
  rowSource: () => Promise<TRow[]>;
  handler: (ctx: JobRunContext, row: TRow) => Promise<void>;
  perRowTimeoutSec?: number; // default 60
  runTimeoutSec?: number; // default 30 * 60 (30 min for the whole run)
  continueOnRowError?: boolean; // default true
  capture?: { source?: "cron" | "plugin"; pluginId?: string };
}): JobHandle;
```

Semantics:

- Skip-if-running at the job level; a second tick during iteration is `skipped`.
- `rowSource()` is called once at the start of the run; the result iterates sequentially.
- Per-row errors are captured as individual `error_records` entries (one per failed row) but the run continues unless `continueOnRowError: false`.
- The `job_runs` entry records aggregate stats: `rows_total`, `rows_succeeded`, `rows_failed`. Run status: all succeeded → `succeeded`; some failed → `partial_failure`; all failed → `failed`; run timeout reached → `timed_out` with whatever stats accumulated; cancel requested → `cancelled`.
- The first row failure's `error_record_id` is stored on the `job_runs` row for the drawer's quick-link; all per-row failures share the run's `request_id` and are discoverable together in `/admin/errors`.

Used for: plugin `perConnection: true` jobs (row source = `service_connections` filtered by plugin), daily preference-profile rebuild (row source = users with new feedback or stale profiles).

For plugin per-connection jobs: the row source is wrapped so the plugin runtime's existing `PluginContext` builder and credential rebuild logic (doc 1 §Lifecycle) run unchanged. The job service provides the iteration and lifecycle only; the plugin-specific semantics — token refresh re-encrypting credentials, health-check updating `status` — stay where they already are.

### `registerTriggerable`

Runs on explicit call. Optionally also on cron.

```ts
function registerTriggerable<TInput, TResult = unknown>(opts: {
  id: string;
  schedule?: string; // optional; if present, also runs on cron with `input: null`
  handler: (ctx: JobRunContext, input: TInput | null) => Promise<TResult>;
  scopeKey?: (input: TInput) => string;
  timeoutSec?: number;
  inputSchema?: JSONSchema; // ajv-validated before handler call
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
- `requiredPermission` determines which HTTP endpoint can call the job: `admin:jobs` jobs are reachable only from `/api/jobs/:id/trigger`; feature jobs are reachable from `/api/jobs/:id/trigger-user` with the feature's `check` function gating access.
- `handler` returns a value; the value is serialized into `job_runs.result` (JSON, truncated at ~4KB with a warning logged on truncation) and returned to the caller. This enables triggerable jobs with user-visible result data (test connection returning `{ ok, latencyMs }`, etc.).

Used for: admin "Test connection" on a connection card, user "Rebuild profile" on `/profile`, any feature that needs to kick off work on demand.

### `registerCoalesced`

Responds to bursts of triggers by running once, after the burst settles.

```ts
function registerCoalesced(opts: {
  id: string;
  debounceMs: number; // required
  maxWaitMs?: number; // default 60_000
  scopeKey: (input: unknown) => string; // required — unlike triggerable
  handler: (ctx: JobRunContext, triggerCount: number) => Promise<void>;
  timeoutSec?: number;
}): CoalescedJobHandle;

interface CoalescedJobHandle extends JobHandle {
  trigger(input: { scopeKey: string; [k: string]: unknown }): void;
  // fire-and-forget; returns synchronously
}
```

Semantics:

- `trigger()` is synchronous and fire-and-forget. Callers do not await work.
- Each trigger for a given scope key starts or extends a debounce timer.
- After `debounceMs` of no further triggers for that scope key, the handler runs once with the accumulated trigger count.
- `maxWaitMs` is the ceiling: once a pending trigger has waited that long, the handler runs even if further triggers keep arriving. Prevents steady-trickle starvation.
- If a handler is running for a scope key when a new trigger arrives, the trigger extends the debounce; the next run includes triggers received during and after the current run.
- `scopeKey` is required. Global coalescing across users is semantically wrong (one user's rating burst should not fold in another's untouched data).

Used for: incremental preference-profile update on `ent_feedback` bursts.

### Job IDs

Globally unique strings. Convention:

- Host-owned jobs: `host.<area>.<task>` (`host.errors.retention_sweep`, `host.auth.pending_auth_sweep`, `host.preference.daily_rebuild`).
- Plugin-declared jobs: `plugin.<plugin_id>.<manifest_job_id>` (`plugin.tmdb.healthCheck`). The plugin runtime prefixes automatically; plugins declare the suffix.
- Feature-triggered jobs: `feature.<feature>.<task>` (`feature.connections.test`, `feature.preference.rebuild`).

Registration rejects duplicate IDs at startup. Re-registration on plugin update is explicit: the old handle is disposed first, then the new one registers.

## Database schema

### `job_runs`

One row per run (including skips, timeouts, and cancellations). Pruning policy: last 50 successful runs per job retained; all failed runs retained indefinitely. `skipped` and `timed_out` count as failures for retention (they're operationally interesting).

```
job_runs
├── id                      text PK                     (cuid2)
├── job_id                  text NOT NULL
├── scope_key               text                        (nullable; from scopeKey function)
├── status                  text NOT NULL               ("succeeded" | "partial_failure" | "failed"
│                                                         | "skipped" | "timed_out" | "cancelled")
├── triggered_by            text NOT NULL               ("cron" | "admin" | "user" | "feature")
├── triggered_by_user_id    text FK → user.id           (nullable)
├── started_at              integer NOT NULL            (unix millis; tick time for skipped)
├── finished_at             integer                     (nullable for in-progress)
├── duration_ms             integer                     (nullable for skipped/in-progress)
├── request_id              text NOT NULL               (correlates to error_records.request_id)
├── rows_total              integer                     (scheduled_per_row only)
├── rows_succeeded          integer                     (scheduled_per_row only)
├── rows_failed             integer                     (scheduled_per_row only)
├── error_record_id         text FK → error_records.id  (nullable)
├── result                  text                        (nullable; JSON, bounded ~4KB)
├── coalesced_count         integer                     (coalesced only)
├── INDEX(job_id, started_at DESC)
├── INDEX(started_at DESC)
├── INDEX(status, started_at DESC)
├── INDEX(request_id)
```

Pruning runs at the end of each successful run, deleting old successful rows beyond the cap for that `job_id`. Failed runs are never pruned.

### `job_config`

Per-job operator overrides. Rows are created lazily — a job without a row runs with its code-declared schedule and is enabled.

```
job_config
├── job_id              text PK
├── enabled             integer NOT NULL DEFAULT 1
├── schedule_override   text                            (nullable)
├── updated_by          text FK → user.id
├── updated_at          integer NOT NULL
```

`schedule_override`, when non-null, replaces the code-declared schedule. The adapter re-registers the cron entry with the new schedule on update. Validation uses croner's own parser.

## HTTP API

All endpoints are Hono routes under `/api/jobs`.

### Admin endpoints (`admin:jobs`)

- `GET /api/jobs` — list all registered jobs. Returns an array of `JobHandle` with `lastRun` and `nextRun` populated.
- `GET /api/jobs/:id` — per-job detail. Returns the `JobHandle` plus recent runs (default 20; `?limit=` up to 100). Each run includes status, timing, and `error_record_id` if any.
- `POST /api/jobs/:id/trigger` — trigger a job whose `requiredPermission` is `admin:jobs`. Body is the input (validated against `inputSchema`). Returns `{ runId, result }`. Returns `job.wrong_kind` if the job isn't triggerable.
- `POST /api/jobs/:id/cancel` — set the abort signal. Returns immediately; actual cancellation happens when the handler observes the signal or hits the run timeout.
- `POST /api/jobs/:id/config` — update `job_config`. Body: `{ enabled?: boolean; scheduleOverride?: string | null }`. Returns the updated `JobHandle`. Re-registers the cron entry on schedule change; new `trigger()` calls on disabled jobs return `job.disabled`.

### User-scoped endpoint (authenticated users)

- `POST /api/jobs/:id/trigger-user` — trigger a job whose `requiredPermission` is `{ kind: "feature", check }`. Body is the input. The feature-specific `check(userId, input)` function runs before the handler; failure returns `job.forbidden`. Returns `{ runId, result }`.

The two trigger endpoints are deliberately separate. An admin calling a feature-scoped job for another user through `/trigger` would be a privilege-escalation surface; `/trigger-user` always passes the authenticated user's id into the feature's `check`, and `/trigger` accepts only `admin:jobs`-required jobs. A job is reachable from exactly one endpoint.

### Errors

All endpoints return `UserFacingError` per the error-management doc. Job-specific codes added to `HOST_ERROR_CODES`:

| Code                  | When                                                    |
| --------------------- | ------------------------------------------------------- |
| `job.not_found`       | Job id not registered                                   |
| `job.already_running` | Same scope key (or scopeless) already running           |
| `job.disabled`        | `job_config.enabled = 0`                                |
| `job.bad_input`       | Input failed schema validation                          |
| `job.wrong_kind`      | Trigger on non-triggerable, cancel on non-running, etc. |
| `job.forbidden`       | Feature `check` returned false                          |

English templates added to `locales/en/errors.json`. Per the error-management doc's discipline, adding a code forces adding a translation entry.

Captured vs not captured (same principle as MCP): expected product-behavior errors are not captured. `job.forbidden`, `job.already_running`, `job.bad_input`, `job.disabled`, `job.not_found`, `job.wrong_kind` are all expected. Handler throws, timeouts, and `job.output_invalid`-class internal bugs are captured as `error` severity.

## Integration with the error-management pipeline

When a job run fails, the service:

1. Catches the exception from the handler (or detects timeout/abort).
2. Calls `captureError(err, { severity: "error", source: "cron" | "plugin", route: `job:${jobId}`, userId: triggeredByUserId, pluginId: capture?.pluginId, context: { jobId, runId, kind, triggeredBy, scopeKey } })`.
3. Stores the returned `error_record_id` on the `job_runs` row.
4. Sets the `job_runs.status` per the rules above.

The admin drawer in `/admin/jobs` has a "View error" link that deep-links to `/admin/errors?requestId={run.request_id}` — the full chain from the job run to every error stamped with that request ID (including per-row failures for `scheduled_per_row` jobs, and plugin-runtime errors for plugin handlers) is one click away.

Request IDs propagate into and out of jobs:

- Jobs triggered by cron generate a fresh `requestId` at run start.
- Jobs triggered by admin or user API calls inherit the HTTP request's `requestId`.
- Jobs triggered by a feature (e.g. `ent_feedback` triggers a coalesced profile update) propagate the caller's `requestId` into the coalesced trigger. When the coalesced handler eventually runs, it uses a fresh `requestId` but the triggering feature's `error_records` chain is still discoverable via the feature call's own request ID.

The scrubber doesn't need new patterns. Job handler inputs don't contain credentials by construction (feature triggers pass their own input shapes; admin inputs come from the admin UI which doesn't surface secrets).

## Admin surface at `/admin/jobs`

Permission: `admin:jobs`. Parallel to `/admin/errors` in structure.

- **Title:** "Jobs". **Subtitle:** "Background tasks running across the system."
- **Aggregate widget:** "`{n}` runs in last 24h, `{m}` failed" with a small per-hour sparkline.
- **Filters:** kind, status, source (host / plugin / feature), enabled/disabled, date range, request ID, free-text search on job id.
- **Table:** columns Timestamp, Job ID, Kind, Status, Duration, Triggered By. Rows clickable; opens a detail drawer (same UX pattern as `/admin/errors`).
- **Detail drawer:** full handle info, recent runs table with status badges, enable/disable toggle, schedule override input (with croner validation on blur), "Trigger now" button for triggerable jobs (form generated from `inputSchema`). Click a failed run → deep-link to its linked error record in `/admin/errors`.
- **Navigation badge:** count of failed runs in the last hour on the sidebar link, matching the `/admin/errors` pattern.

## Migration from existing jobs

| Existing location                                          | Kind                  | Migration                                                                                                                                                                                               |
| ---------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plugin runtime — `manifest.jobs[]` (global)                | `scheduled`           | Runtime wraps plugin handler with `PluginContext` builder and calls `registerScheduled` with `capture: { source: "plugin", pluginId }`                                                                  |
| Plugin runtime — `manifest.jobs[]` (`perConnection: true`) | `scheduled_per_row`   | Row source = `service_connections` filtered by plugin; handler wrapper builds per-user context and invokes plugin handler                                                                               |
| Host `pending_auth` sweep                                  | `scheduled`           | Called from startup; runs nightly                                                                                                                                                                       |
| Host `plugin_store` expired-row sweep                      | `scheduled`           | Called from startup; runs nightly                                                                                                                                                                       |
| Host `error_records` retention sweep                       | `scheduled`           | Called from startup; reads retention from app config                                                                                                                                                    |
| Admin "Test connection" endpoint                           | `registerTriggerable` | `scopeKey: (input) => input.connectionId`; `requiredPermission: "admin:jobs"`                                                                                                                           |
| User "Test connection" on own connection                   | `registerTriggerable` | Same job id can serve both via the two endpoints only if permission model supports it; cleaner to have a separate `feature.connections.test-user` with `requiredPermission: { kind: "feature", check }` |

No behavior changes. Timing, semantics, credential-rebuild on plugin token refresh, status-update on plugin-job failure — all stay exactly as they are in docs 1 and 2. The job service provides the lifecycle, not the semantics.

A convention emerges from the migration: **jobs never call each other directly**. If job A's output should trigger job B, job A's handler calls `jobService.find("feature.b").trigger(...)`. No implicit chaining, no event bus. Keeps the dependency graph visible.

The plugin architecture, media-service, and error-management docs each get a small revision note in their next iteration pointing at the job-service doc for the jobs they previously inlined. No structural changes to those docs.

## Layout

```
server/
├── jobs/
│   ├── index.ts                    # public API: registerScheduled, registerScheduledPerRow,
│   │                               # registerTriggerable, registerCoalesced, unregister
│   ├── registry.ts                 # in-memory JobHandle registry
│   ├── runner.ts                   # execution wrapper: concurrency, timing, abort, history
│   ├── scheduled.ts                # scheduled kind
│   ├── scheduled-per-row.ts        # scheduled_per_row kind
│   ├── triggerable.ts              # triggerable kind
│   ├── coalesced.ts                # coalesced kind + debounce timers
│   ├── croner-adapter.ts           # only file that imports croner
│   ├── history.ts                  # job_runs writes, pruning, queries
│   ├── config.ts                   # job_config reads/writes, schedule-override logic
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
└── job-service-guide.md            # for contributors: when to use which kind

locales/
└── en/
    └── errors.json                 # adds job.* English templates
```

A lint-level sanity check is worth having: an ESLint rule that flags direct `import { Cron } from "croner"` anywhere outside `server/jobs/croner-adapter.ts`. Prevents regression into ad-hoc scheduling after the migration.

## Testing

### Per-kind unit tests

One test file per kind, mocking croner and the database.

- **`scheduled`:** runs on tick; second tick during execution → `skipped`; handler throw → `failed` with captured error; timeout → `timed_out`.
- **`scheduled_per_row`:** iterates `rowSource()` sequentially; per-row error with `continueOnRowError: true` → run continues, individual errors captured, aggregate stats correct; `continueOnRowError: false` → run stops at first error; run-level timeout bounds the whole run.
- **`triggerable`:** scopeless → second concurrent trigger returns `job.already_running`; scoped → different scope keys run in parallel; schema validation failure returns `job.bad_input`; admin vs feature permission paths; handler return value serialized into `result` and truncated at ~4KB with warning logged.
- **`coalesced`:** rapid bursts within `debounceMs` result in a single handler invocation with correct `triggerCount`; `maxWaitMs` fires handler on steady trickle; triggers during handler execution extend into the next run; different scope keys coalesce independently.

### Concurrency and lifecycle

- Two simultaneous scopeless triggers → second returns `job.already_running`.
- Cancel while running: signal fires, cooperative handler aborts and record written as `cancelled`; uncooperative handler runs to completion but record still written as `cancelled` with `duration_ms` populated.
- `unregister(jobId)`: subsequent triggers return `job.not_found`; cron entry removed from croner; an in-flight run completes normally.

### History retention

- Fixture with 60 succeeded + 3 failed runs → pruning keeps 50 latest succeeded + all 3 failed (53 rows total).
- `skipped` and `timed_out` runs retained indefinitely.

### Error-management integration

- Handler throws → `captureError` called with correct source/route/context; `job_runs.error_record_id` populated; `/admin/errors` search by the run's `request_id` returns the error record.
- `scheduled_per_row` with two failing rows → two `error_records` entries sharing the same `request_id`; `job_runs.error_record_id` is the first failure.
- Expected errors (`job.forbidden`, `job.already_running`, etc.) → not captured.

### API endpoints

- `admin:jobs`-required endpoints reject user tokens; `/trigger-user` rejects admin-only jobs.
- Feature `check(userId, input)` invoked with the authenticated user's id; failure returns `job.forbidden`.
- `POST /api/jobs/:id/config` with invalid cron returns `job.bad_input`; valid cron re-registers the schedule and the next scheduled tick reflects it.

### Migration integration

- Post-migration startup: every previously-existing job is registered via the service.
- Lint rule catches direct `croner` imports outside the adapter.
- Plugin install: plugin-declared jobs appear in `/api/jobs` list after the install completes.
- Plugin uninstall: those jobs are removed from the registry; their `job_runs` history remains per retention rules.

## Open questions / deferred

- **Distributed coordination for multi-instance.** V1 is single-instance-for-jobs per the deployment constraint documented in the README. Advisory-lock design (Postgres `pg_try_advisory_lock` keyed on a hash of job id + scope key) is ready to pick up when multi-instance becomes a real requirement. Also worth considering at that time: a startup-time detection that refuses to start a second jobs-enabled instance.
- **Parallelism within `scheduled_per_row`.** Sequential in v1. When a per-connection job over many rows becomes the critical path, bounded parallelism slots in non-breakingly — `runOpts?: { concurrency?: number }` on the kind's registration, with careful thought about coordinated backoff on external API rate limits.
- **Rate limiting on user-scoped triggers.** A user spamming "Rebuild profile" 100 times a minute gets 99 `job.already_running` responses plus 1 successful run. Correct but noisy. Per-user trigger buckets (similar to the MCP doc's pattern) are a follow-up if this becomes a hot path.
- **Typed run results for `triggerable`.** Generic parameter in the API preserves types at registration; the runtime serialization of `result` into JSON and back to the caller uses `unknown`. Callers typecast. Revisit if this causes friction.
- **Automatic retry on failure.** Explicitly deferred. Handlers own retry logic. Uniform retry policy (`retry?: { attempts; backoffMs }`) is a non-breaking addition later.
- **Schedule visualizer in the admin UI.** Admins set cron expressions directly with croner validation. Visual cron builder is a UX enhancement, not v1.
- **Job dependencies / DAGs.** Not supported. If X depends on Y, X's handler awaits Y's trigger explicitly. No scheduler magic planned.
- **Streaming run output.** A long-running triggerable job that wants to stream progress back to the caller (e.g. "Rebuilding profile: 50% done") would need SSE or similar. Not in v1; the `result` is a single final payload.
