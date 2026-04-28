import { captureError } from "../errors/capture";
import { assertValidSchedule, scheduleCron, unscheduleCron } from "./croner-adapter";
import { register, type RegistryEntry } from "./registry";
import { buildJobHandle, scheduleJobFromConfig } from "./schedule-helpers";
import { setCurrentRow } from "./run-logger";
import { isRunning, run } from "./runner";
import { shouldSkipTick } from "./tick-guard";
import type { JobHandle, JobRunStatus } from "@ent-mcp/shared/jobs";
import type { JobCaptureMeta, JobRunContext } from "./types";

const DEFAULT_PER_ROW_TIMEOUT_SEC = 60;
const DEFAULT_RUN_TIMEOUT_SEC = 30 * 60;

export interface RegisterScheduledPerRowOptions<TRow> {
  id: string;
  name: string;
  description?: string;
  schedule: string;
  rowSource: () => Promise<TRow[]>;
  handler: (ctx: JobRunContext, row: TRow) => Promise<void>;
  perRowTimeoutSec?: number;
  runTimeoutSec?: number;
  continueOnRowError?: boolean;
  adminTriggerable?: boolean;
  capture?: JobCaptureMeta;
}

interface RowAggregate {
  total: number;
  succeeded: number;
  failed: number;
  firstErrorRecordId: string | null;
}

export function registerScheduledPerRow<TRow>(
  opts: RegisterScheduledPerRowOptions<TRow>,
): JobHandle {
  assertValidSchedule(opts.schedule);

  const continueOnRowError = opts.continueOnRowError ?? true;
  const perRowTimeoutSec = opts.perRowTimeoutSec ?? DEFAULT_PER_ROW_TIMEOUT_SEC;
  const runTimeoutSec = opts.runTimeoutSec ?? DEFAULT_RUN_TIMEOUT_SEC;
  const adminTriggerable = opts.adminTriggerable ?? false;

  const entry: RegistryEntry = {
    id: opts.id,
    name: opts.name,
    description: opts.description,
    kind: "scheduled_per_row",
    schedule: opts.schedule,
    capture: opts.capture,
    dispose() {
      unscheduleCron(opts.id);
    },
    triggerFromApi: adminTriggerable
      ? async (_input, source) => {
          if (isRunning(opts.id)) {
            const { jobErrors } = await import("./errors");
            throw jobErrors.alreadyRunning(opts.id);
          }
          const aggregate: RowAggregate = {
            total: 0,
            succeeded: 0,
            failed: 0,
            firstErrorRecordId: null,
          };
          const outcome = await run({
            jobId: opts.id,
            kind: "scheduled_per_row",
            triggeredBy: source.triggeredBy,
            triggeredByUserId: source.triggeredByUserId ?? null,
            requestId: source.requestId,
            timeoutSec: runTimeoutSec,
            capture: opts.capture,
            handler: (ctx) => iterateRows(ctx, aggregate),
            statusOverride: buildStatusOverride(aggregate),
          });
          return { runId: outcome.runId, result: undefined };
        }
      : undefined,
    onScheduleChange(schedule) {
      scheduleCron(opts.id, schedule, () => void onTick());
    },
    onEnabledChange(enabled) {
      if (enabled) void scheduleJobFromConfig(opts.id, opts.schedule, () => void onTick());
      else unscheduleCron(opts.id);
    },
  };
  register(entry);

  async function onTick(): Promise<void> {
    if (await shouldSkipTick(opts.id)) return;

    const aggregate: RowAggregate = { total: 0, succeeded: 0, failed: 0, firstErrorRecordId: null };

    await run({
      jobId: opts.id,
      kind: "scheduled_per_row",
      triggeredBy: "cron",
      timeoutSec: runTimeoutSec,
      capture: opts.capture,
      handler: (ctx) => iterateRows(ctx, aggregate),
      statusOverride: buildStatusOverride(aggregate),
    });
  }

  async function iterateRows(ctx: JobRunContext, aggregate: RowAggregate): Promise<void> {
    const rows = await opts.rowSource();
    aggregate.total = rows.length;

    for (const row of rows) {
      if (ctx.abortSignal.aborted) return;
      const rowLabel = bestEffortRowId(row);
      setCurrentRow(rowLabel);
      try {
        await runRowWithTimeout(ctx, row, perRowTimeoutSec);
        aggregate.succeeded += 1;
      } catch (err) {
        aggregate.failed += 1;
        const errorRecordId = await captureRowFailure(err, ctx);
        if (!aggregate.firstErrorRecordId) aggregate.firstErrorRecordId = errorRecordId;
        if (!continueOnRowError) throw err;
      } finally {
        setCurrentRow(undefined);
      }
    }
  }

  async function runRowWithTimeout(
    ctx: JobRunContext,
    row: TRow,
    timeoutSec: number,
  ): Promise<void> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error("per-row timeout")), timeoutSec * 1000);
    });
    try {
      await Promise.race([opts.handler(ctx, row), timeout]);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }

  async function captureRowFailure(err: unknown, ctx: JobRunContext): Promise<string> {
    return captureError(err, {
      severity: "error",
      source: opts.capture?.source ?? "cron",
      code: "cron.job_failed",
      route: `job:${opts.id}`,
      pluginId: opts.capture?.pluginId ?? null,
      requestId: ctx.requestId,
      context: { jobId: opts.id, runId: ctx.runId, kind: "scheduled_per_row" },
    });
  }

  void scheduleJobFromConfig(opts.id, opts.schedule, () => void onTick());

  return buildJobHandle(opts, "scheduled_per_row", adminTriggerable);
}

function buildStatusOverride(aggregate: RowAggregate) {
  return ({
    thrown,
    timedOut,
    cancelled,
  }: {
    thrown: unknown;
    timedOut: boolean;
    cancelled: boolean;
  }) => {
    if (cancelled) return undefined;
    if (timedOut) {
      return {
        status: "timed_out" as const,
        rowsTotal: aggregate.total,
        rowsSucceeded: aggregate.succeeded,
        rowsFailed: aggregate.failed,
      };
    }
    return {
      status: resolvePerRowStatus(aggregate, thrown),
      rowsTotal: aggregate.total,
      rowsSucceeded: aggregate.succeeded,
      rowsFailed: aggregate.failed,
    };
  };
}

function resolvePerRowStatus(aggregate: RowAggregate, thrown: unknown): JobRunStatus {
  if (thrown !== undefined && aggregate.succeeded === 0 && aggregate.failed === 0) return "failed";
  if (thrown !== undefined) return aggregate.succeeded > 0 ? "partial_failure" : "failed";
  if (aggregate.failed > 0 && aggregate.succeeded > 0) return "partial_failure";
  if (aggregate.failed > 0) return "failed";
  return "succeeded";
}

/** Best-effort row identifier for log tagging. Uses primary key if present. */
function bestEffortRowId(row: unknown): string | undefined {
  if (row === null || row === undefined) return undefined;
  if (typeof row !== "object") return String(row as string | number | boolean);
  const obj = row as Record<string, unknown>;
  if (typeof obj.id === "string" || typeof obj.id === "number") return String(obj.id);
  if (typeof obj.userId === "string") return obj.userId;
  return undefined;
}
