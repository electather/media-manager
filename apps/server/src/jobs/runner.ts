import { consola } from "consola";
import { captureError } from "../diagnostics/capture";
import { runWithRequestContext, newRequestId } from "../diagnostics/request-context";
import { emit } from "./emit";
import {
  EVENT_DISPATCHER_JOB_IDS,
  JOB_EVENTS,
  jobRunFailedPayload,
  jobSyncSucceededPayload,
} from "./runtime-events";
import { getConfig, type JobConfigRow } from "./config";
import { finishRun, latestRun, startRun } from "./history";
import { createRunLogger, runWithLogCapture, serializeRunLogs } from "./run-logger";
import { isSyncJob, pluginIdFromJobId } from "./sync-classifier";
import type { JobKind, JobRunStatus, JobTriggeredBy } from "@nama/shared/jobs";
import type { JobCaptureMeta, JobRunContext } from "./types";
import { isNil } from "es-toolkit/predicate";

const DEFAULT_TIMEOUT_SEC = 300;

export interface RunRequest {
  jobId: string;
  kind: JobKind;
  scopeKey?: string | null;
  triggeredBy: JobTriggeredBy;
  triggeredByUserId?: string | null;
  requestId?: string;
  timeoutSec?: number;
  capture?: JobCaptureMeta;
  coalescedCount?: number | null;
  handler: (ctx: JobRunContext) => Promise<unknown>;
  /** Overrides the status derived from handler outcome. Used by per-row runs. */
  statusOverride?: (outcome: {
    thrown: unknown;
    timedOut: boolean;
    cancelled: boolean;
  }) =>
    | { status: JobRunStatus; rowsTotal?: number; rowsSucceeded?: number; rowsFailed?: number }
    | undefined;
}

export interface RunOutcome {
  runId: string;
  status: JobRunStatus;
  result: unknown;
  error: unknown;
  durationMs: number;
}

/**
 * Active run registry. Keyed by `${jobId}::${scopeKey ?? ""}`. Value is the abort
 * controller for the in-flight handler. Used for skip-if-running checks and for
 * cancel. In-memory only; doc §Non-goals says multi-instance coordination is v2.
 */
const active = new Map<string, AbortController>();

function activeKey(jobId: string, scopeKey: string | null | undefined): string {
  return `${jobId}::${scopeKey ?? ""}`;
}

export function isRunning(jobId: string, scopeKey?: string | null): boolean {
  return active.has(activeKey(jobId, scopeKey));
}

/**
 * Returns true if any of the named jobs has an active run regardless of
 * scope. Used by `host.catalog.prune` to skip a sweep while the rec-build
 * jobs (nightly + manual rebuild) are still writing — eviction would
 * otherwise race their in-flight catalog references.
 */
// fallow-ignore-next-line complexity
export function anyRunning(jobIds: readonly string[]): boolean {
  if (jobIds.length === 0) return false;
  const wanted = new Set(jobIds);
  for (const key of active.keys()) {
    const sep = key.indexOf("::");
    const id = sep >= 0 ? key.slice(0, sep) : key;
    if (wanted.has(id)) return true;
  }
  return false;
}

/** Requests cancellation of a running (jobId, scopeKey). Returns true iff there was something to cancel. */
export function requestCancel(jobId: string, scopeKey?: string | null): boolean {
  const controller = active.get(activeKey(jobId, scopeKey));
  if (!controller) return false;
  controller.abort(new Error("job cancelled"));
  return true;
}

/**
 * Core execution wrapper. Handles concurrency gating, request context,
 * timeout/cancel, error capture, log capture, and history writes. Callers
 * provide the handler and the dispatch-specific policy (e.g. per-row status
 * resolution).
 */
// fallow-ignore-next-line complexity
export async function run(req: RunRequest): Promise<RunOutcome> {
  if (isRunning(req.jobId, req.scopeKey)) {
    return {
      runId: "",
      status: "failed",
      result: undefined,
      error: new Error("already running"),
      durationMs: 0,
    };
  }

  const controller = new AbortController();
  active.set(activeKey(req.jobId, req.scopeKey), controller);

  const runId = crypto.randomUUID();
  const requestId = req.requestId ?? newRequestId();
  const startedAt = Date.now();
  const route = `job:${req.jobId}`;

  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let runStarted = false;

  let execResult: Awaited<ReturnType<typeof executeHandlerWithCapture>>;
  try {
    const cfg = await getConfig(req.jobId);
    const logger = createRunLogger(req.jobId, runId, requestId);

    await startRun({
      id: runId,
      jobId: req.jobId,
      scopeKey: req.scopeKey ?? null,
      triggeredBy: req.triggeredBy,
      triggeredByUserId: req.triggeredByUserId ?? null,
      requestId,
      startedAt,
      coalescedCount: req.coalescedCount ?? null,
    });
    runStarted = true;

    const timeoutMs = (req.timeoutSec ?? DEFAULT_TIMEOUT_SEC) * 1000;
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error("job timed out"));
    }, timeoutMs);

    const ctx: JobRunContext = {
      runId,
      triggeredBy: req.triggeredBy,
      triggeredByUserId: req.triggeredByUserId ?? undefined,
      scopeKey: req.scopeKey ?? undefined,
      requestId,
      logger,
      abortSignal: controller.signal,
    };

    execResult = await executeHandlerWithCapture(req, ctx, cfg, requestId, route);
  } catch (err) {
    // If startRun succeeded but a later step threw before executeHandlerWithCapture
    // could finalize the row, finalize it here as failed so the row does not stay
    // stuck at "running". executeHandlerWithCapture has its own try/catch today and
    // never re-throws — this guards future code added between startRun and execute.
    if (runStarted) {
      await finalizeOrphanedRunAsFailed({ runId, jobId: req.jobId, startedAt });
    }
    throw err;
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    active.delete(activeKey(req.jobId, req.scopeKey));
  }

  const { result, thrown, logs, logsTruncated } = execResult;

  const finishedAt = Date.now();
  const durationMs = finishedAt - startedAt;
  const cancelled = controller.signal.aborted && !timedOut;

  const override = req.statusOverride?.({ thrown, timedOut, cancelled });
  const status = override?.status ?? resolveStatus({ thrown, timedOut, cancelled });

  const errorRecordId =
    thrown !== undefined && status !== "cancelled"
      ? await captureFailure(req, thrown, { runId, requestId, route })
      : null;

  await finishRun({
    id: runId,
    jobId: req.jobId,
    status,
    finishedAt,
    durationMs,
    errorRecordId,
    result: status === "succeeded" ? result : undefined,
    logs,
    logsTruncated,
    rowsTotal: override?.rowsTotal ?? null,
    rowsSucceeded: override?.rowsSucceeded ?? null,
    rowsFailed: override?.rowsFailed ?? null,
  });

  await emitJobOutcome(req, {
    runId,
    status,
    thrown,
    rowsSucceeded: override?.rowsSucceeded ?? null,
  });

  return { runId, status, result, error: thrown, durationMs };
}

/** Convenience for scheduled dispatchers that need to decide whether to record a skip. */
export async function recentRunSummary(jobId: string): ReturnType<typeof latestRun> {
  return latestRun(jobId);
}

async function executeHandlerWithCapture(
  req: RunRequest,
  ctx: JobRunContext,
  cfg: JobConfigRow,
  requestId: string,
  route: string,
): Promise<{ result: unknown; thrown: unknown; logs: string | null; logsTruncated: number }> {
  let result: unknown;
  let thrown: unknown;
  let logs: string | null = null;
  let logsTruncated = 0;
  try {
    result = await runWithRequestContext(
      { requestId, userId: req.triggeredByUserId ?? null, route },
      () =>
        runWithLogCapture(cfg.logLevel, async () => {
          try {
            return await req.handler(ctx);
          } finally {
            const captured = serializeRunLogs();
            logs = captured.logs;
            logsTruncated = captured.logsTruncated;
          }
        }),
    );
  } catch (err) {
    thrown = err;
  }
  return { result, thrown, logs, logsTruncated };
}

function resolveStatus(outcome: {
  thrown: unknown;
  timedOut: boolean;
  cancelled: boolean;
}): JobRunStatus {
  if (outcome.cancelled) return "cancelled";
  if (outcome.timedOut) return "timed_out";
  if (outcome.thrown !== undefined) return "failed";
  return "succeeded";
}

/**
 * Notification emit hook fired after every run finishes. Two typed events
 * surface on the typed bus:
 *   - `jobs.run.failed` for any non-success terminal status. Consumed by
 *     `notifications/jobs/on-jobs-run-failed.ts`, which routes to an admin
 *     `job.run.failed` notification.
 *   - `jobs.sync.succeeded` for sync-classified jobs whose user trigger
 *     completed. Consumed by `notifications/jobs/on-jobs-sync-succeeded.ts`,
 *     which routes to a user `connection.sync.succeeded` notification.
 *     Cron-fired runs (no `triggeredByUserId`) are skipped silently per
 *     design.
 *
 * Emit failures must never propagate to the host operation — logged and
 * swallowed.
 */
// fallow-ignore-next-line complexity
async function emitJobOutcome(
  req: RunRequest,
  outcome: { runId: string; status: JobRunStatus; thrown: unknown; rowsSucceeded: number | null },
): Promise<void> {
  if (EVENT_DISPATCHER_JOB_IDS.has(req.jobId)) return;

  if (
    outcome.status === "failed" ||
    outcome.status === "timed_out" ||
    outcome.status === "partial_failure"
  ) {
    await safeEmit(() =>
      emit(JOB_EVENTS.RUN_FAILED, jobRunFailedPayload, {
        jobId: req.jobId,
        runId: outcome.runId,
        status: outcome.status,
        error: errorMessageFrom(outcome.thrown),
      }),
    );
    return;
  }

  if (outcome.status !== "succeeded") return;
  if (!isSyncJob(req.kind)) return;
  if (!req.triggeredByUserId) return;

  const pluginId = pluginIdFromJobId(req.jobId) ?? "host";
  const connectionId = req.scopeKey ?? "";
  await safeEmit(() =>
    emit(JOB_EVENTS.SYNC_SUCCEEDED, jobSyncSucceededPayload, {
      jobId: req.jobId,
      runId: outcome.runId,
      connectionId,
      pluginId,
      itemCount: outcome.rowsSucceeded ?? 0,
      triggeredByUserId: req.triggeredByUserId,
    }),
  );
}

async function safeEmit(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    consola.error(`[runner] notification emit failed:`, err);
  }
}

async function finalizeOrphanedRunAsFailed(args: {
  runId: string;
  jobId: string;
  startedAt: number;
}): Promise<void> {
  const finishedAt = Date.now();
  try {
    await finishRun({
      id: args.runId,
      jobId: args.jobId,
      status: "failed",
      finishedAt,
      durationMs: finishedAt - args.startedAt,
      errorRecordId: null,
      result: undefined,
      logs: null,
      logsTruncated: 0,
      rowsTotal: null,
      rowsSucceeded: null,
      rowsFailed: null,
    });
  } catch (err) {
    consola.error(`[runner] failed to finalize orphaned run ${args.runId}:`, err);
  }
}

// fallow-ignore-next-line complexity
function errorMessageFrom(err: unknown): string | null {
  if (isNil(err)) return null;
  if (err instanceof Error) return err.message || err.name;
  return typeof err === "string" ? err : null;
}

// fallow-ignore-next-line complexity
async function captureFailure(
  req: RunRequest,
  err: unknown,
  meta: { runId: string; requestId: string; route: string },
): Promise<string> {
  return captureError(err, {
    severity: "error",
    source: req.capture?.source ?? "cron",
    code: "cron.job_failed",
    route: meta.route,
    userId: req.triggeredByUserId ?? null,
    pluginId: req.capture?.pluginId ?? null,
    requestId: meta.requestId,
    context: {
      jobId: req.jobId,
      runId: meta.runId,
      kind: req.kind,
      triggeredBy: req.triggeredBy,
      scopeKey: req.scopeKey ?? null,
    },
  });
}
