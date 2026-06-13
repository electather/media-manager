import { captureError } from "../diagnostics/capture";
import { assertValidSchedule } from "./croner-adapter";
import { register, type RegistryEntry } from "./registry";
import {
  assertNotRunning,
  buildJobHandle,
  buildScheduledCallbacks,
  scheduleJobFromConfig,
} from "./schedule-helpers";
import { setCurrentRow } from "./run-logger";
import { run } from "./runner";
import { shouldSkipTick } from "./tick-guard";
import type { JobHandle, JobRunStatus } from "@nama/shared/jobs";
import type { JobCaptureMeta, JobRunContext } from "./types";
import { isNil, isNotNil, isPrimitive, isString } from "es-toolkit/predicate";

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

// fallow-ignore-next-line complexity
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
    ...buildScheduledCallbacks(opts, onTick),
    triggerFromApi: adminTriggerable
      ? async (_input, source) => {
          await assertNotRunning(opts.id);
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

  // fallow-ignore-next-line complexity
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

  // fallow-ignore-next-line complexity
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

// fallow-ignore-next-line complexity
function resolvePerRowStatus(aggregate: RowAggregate, thrown: unknown): JobRunStatus {
  if (isNotNil(thrown) && aggregate.succeeded === 0 && aggregate.failed === 0) return "failed";
  if (isNotNil(thrown)) return aggregate.succeeded > 0 ? "partial_failure" : "failed";
  if (aggregate.failed > 0 && aggregate.succeeded > 0) return "partial_failure";
  if (aggregate.failed > 0) return "failed";
  return "succeeded";
}

/** Best-effort row identifier for log tagging. Uses primary key if present. */
// fallow-ignore-next-line complexity
function bestEffortRowId(row: unknown): string | undefined {
  if (isNil(row)) return undefined;
  if (isPrimitive(row)) return String(row);
  const obj = row as Record<string, unknown>;
  if (isPrimitive(obj.id)) return String(obj.id);
  if (isString(obj.userId)) return obj.userId;
  return undefined;
}
