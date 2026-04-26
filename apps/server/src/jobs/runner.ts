import { consola } from "consola";
import { captureError } from "../errors/capture";
import { runWithRequestContext, newRequestId } from "../errors/request-context";
import { emit } from "../notifications/emit";
import { getConfig } from "./config";
import { finishRun, latestRun, startRun } from "./history";
import { createRunLogger, runWithLogCapture, serializeRunLogs } from "./run-logger";
import { isSyncJob, pluginIdFromJobId } from "./sync-classifier";
import type { JobKind, JobRunStatus, JobTriggeredBy } from "@ent-mcp/shared/jobs";
import type { CaptureMeta, JobRunContext } from "./types";

const DEFAULT_TIMEOUT_SEC = 300;

export interface RunRequest {
  jobId: string;
  kind: JobKind;
  scopeKey?: string | null;
  triggeredBy: JobTriggeredBy;
  triggeredByUserId?: string | null;
  requestId?: string;
  timeoutSec?: number;
  capture?: CaptureMeta;
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

  let result: unknown = undefined;
  let thrown: unknown = undefined;
  let timedOut = false;
  let logs: string | null = null;
  let logsTruncated = 0;

  const timeoutMs = (req.timeoutSec ?? DEFAULT_TIMEOUT_SEC) * 1000;
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("job timed out"));
  }, timeoutMs);

  try {
    const ctx: JobRunContext = {
      runId,
      triggeredBy: req.triggeredBy,
      triggeredByUserId: req.triggeredByUserId ?? undefined,
      scopeKey: req.scopeKey ?? undefined,
      requestId,
      logger,
      abortSignal: controller.signal,
    };
    result = await runWithRequestContext(
      {
        requestId,
        userId: req.triggeredByUserId ?? null,
        route,
      },
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
  } finally {
    clearTimeout(timeoutHandle);
    active.delete(activeKey(req.jobId, req.scopeKey));
  }

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
 * Notification emit hook fired after every run finishes. Two events surface:
 *   - `job.run.failed` for any non-success terminal status (admin audience).
 *   - `connection.sync.succeeded` for sync-classified jobs whose user trigger
 *     completed (user audience). Cron-fired runs (no `triggeredByUserId`) are
 *     skipped silently per design.
 *
 * Emit failures must never propagate to the host operation — they are logged
 * and swallowed.
 */
async function emitJobOutcome(
  req: RunRequest,
  outcome: { runId: string; status: JobRunStatus; thrown: unknown; rowsSucceeded: number | null },
): Promise<void> {
  if (
    outcome.status === "failed" ||
    outcome.status === "timed_out" ||
    outcome.status === "partial_failure"
  ) {
    await safeEmit({
      type: "job.run.failed",
      category: "system",
      severity: "error",
      audience: { kind: "admin", permission: "admin:server" },
      payload: {
        jobId: req.jobId,
        runId: outcome.runId,
        error: errorMessageFrom(outcome.thrown) ?? outcome.status,
      },
    });
    return;
  }

  if (outcome.status !== "succeeded") return;
  if (!isSyncJob(req.kind)) return;
  if (!req.triggeredByUserId) return;

  const pluginId = pluginIdFromJobId(req.jobId) ?? "host";
  const connectionId = req.scopeKey ?? "";
  await safeEmit({
    type: "connection.sync.succeeded",
    category: "sync",
    severity: "info",
    audience: { kind: "user", userId: req.triggeredByUserId },
    payload: {
      connectionId,
      pluginId,
      itemCount: outcome.rowsSucceeded ?? 0,
    },
  });
}

async function safeEmit(event: Parameters<typeof emit>[0]): Promise<void> {
  try {
    await emit(event);
  } catch (err) {
    consola.error(`[runner] notification emit failed for ${event.type}:`, err);
  }
}

function errorMessageFrom(err: unknown): string | null {
  if (err === null || err === undefined) return null;
  if (err instanceof Error) return err.message || err.name;
  return typeof err === "string" ? err : null;
}

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
