import { consola } from "consola";
import { captureError } from "../errors/capture";
import { newRequestId } from "../errors/request-context";
import { assertValidSchedule, nextFireTime, scheduleCron, unscheduleCron } from "./croner-adapter";
import { getConfig, effectiveSchedule } from "./config";
import { recordSkipped } from "./history";
import { register, type RegistryEntry } from "./registry";
import { isRunning, run } from "./runner";
import type { CaptureMeta, JobHandle, JobRunContext, JobRunStatus } from "./types";

const DEFAULT_PER_ROW_TIMEOUT_SEC = 60;
const DEFAULT_RUN_TIMEOUT_SEC = 30 * 60;

export interface RegisterScheduledPerRowOptions<TRow> {
  id: string;
  schedule: string;
  rowSource: () => Promise<TRow[]>;
  handler: (ctx: JobRunContext, row: TRow) => Promise<void>;
  perRowTimeoutSec?: number;
  runTimeoutSec?: number;
  continueOnRowError?: boolean;
  capture?: CaptureMeta;
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

  const entry: RegistryEntry = {
    id: opts.id,
    kind: "scheduled_per_row",
    schedule: opts.schedule,
    capture: opts.capture,
    dispose() {
      unscheduleCron(opts.id);
    },
    onScheduleChange(schedule) {
      scheduleCron(opts.id, schedule, () => void onTick());
    },
    onEnabledChange(enabled) {
      if (enabled) void scheduleFromConfig();
      else unscheduleCron(opts.id);
    },
  };
  register(entry);

  async function onTick(): Promise<void> {
    const cfg = await getConfig(opts.id);
    if (!cfg.enabled) return;
    if (isRunning(opts.id)) {
      await recordSkipped({
        id: crypto.randomUUID(),
        jobId: opts.id,
        triggeredBy: "cron",
        requestId: newRequestId(),
        tickAt: Date.now(),
      });
      return;
    }

    const aggregate: RowAggregate = { total: 0, succeeded: 0, failed: 0, firstErrorRecordId: null };

    await run({
      jobId: opts.id,
      kind: "scheduled_per_row",
      triggeredBy: "cron",
      timeoutSec: runTimeoutSec,
      capture: opts.capture,
      handler: (ctx) => iterateRows(ctx, aggregate),
      statusOverride: ({ thrown, timedOut, cancelled }) => {
        if (cancelled) return undefined;
        if (timedOut) {
          return {
            status: "timed_out",
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
      },
    });
  }

  async function iterateRows(ctx: JobRunContext, aggregate: RowAggregate): Promise<void> {
    const rows = await opts.rowSource();
    aggregate.total = rows.length;

    for (const row of rows) {
      if (ctx.abortSignal.aborted) return;
      try {
        await runRowWithTimeout(ctx, row, perRowTimeoutSec);
        aggregate.succeeded += 1;
      } catch (err) {
        aggregate.failed += 1;
        const errorRecordId = await captureRowFailure(err, ctx);
        if (!aggregate.firstErrorRecordId) aggregate.firstErrorRecordId = errorRecordId;
        if (!continueOnRowError) throw err;
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

  async function scheduleFromConfig(): Promise<void> {
    const cfg = await getConfig(opts.id);
    if (!cfg.enabled) {
      unscheduleCron(opts.id);
      return;
    }
    const schedule = effectiveSchedule(opts.schedule, cfg.scheduleOverride);
    if (!schedule) return;
    try {
      assertValidSchedule(schedule);
    } catch (err) {
      consola.warn(
        `[job:${opts.id}] invalid schedule override, falling back: ${err instanceof Error ? err.message : String(err)}`,
      );
      scheduleCron(opts.id, opts.schedule, () => void onTick());
      return;
    }
    scheduleCron(opts.id, schedule, () => void onTick());
  }

  void scheduleFromConfig();

  return {
    id: opts.id,
    kind: "scheduled_per_row",
    enabled: true,
    adminTriggerable: false,
    schedule: opts.schedule,
    nextRun: nextFireTime(opts.id) ?? undefined,
  };
}

function resolvePerRowStatus(aggregate: RowAggregate, thrown: unknown): JobRunStatus {
  if (thrown !== undefined && aggregate.succeeded === 0 && aggregate.failed === 0) return "failed";
  if (thrown !== undefined) return aggregate.succeeded > 0 ? "partial_failure" : "failed";
  if (aggregate.failed > 0 && aggregate.succeeded > 0) return "partial_failure";
  if (aggregate.failed > 0) return "failed";
  return "succeeded";
}
