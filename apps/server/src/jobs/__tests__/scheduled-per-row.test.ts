import { describe, it, expect, beforeEach, vi } from "vite-plus/test";
import { resetSinks } from "../../diagnostics/capture";

const finished: Array<{
  status: string;
  rowsTotal: number;
  rowsSucceeded: number;
  rowsFailed: number;
}> = [];

vi.mock("../../notifications/emit", () => ({
  emit: async () => undefined,
}));

vi.mock("../history", () => ({
  startRun: async () => undefined,
  finishRun: async (args: {
    status: string;
    rowsTotal: number;
    rowsSucceeded: number;
    rowsFailed: number;
  }) => {
    finished.push(args);
  },
  recordSkipped: async () => undefined,
  latestRun: async () => null,
  recentRuns: async () => [],
  pruneSuccessfulRuns: async () => 0,
}));

vi.mock("../config", () => ({
  getConfig: async (jobId: string) => ({ jobId, enabled: true, scheduleOverride: null }),
  updateConfig: async () => ({ jobId: "x", enabled: true, scheduleOverride: null }),
  effectiveSchedule: (d: string | undefined) => d,
}));

vi.mock("../croner-adapter", () => ({
  scheduleCron: () => undefined,
  unscheduleCron: () => undefined,
  nextFireTime: () => null,
  unscheduleAll: () => undefined,
  assertValidSchedule: () => undefined,
}));

const { run } = await import("../runner");
const { registerScheduledPerRow } = await import("../scheduled-per-row");
const { findEntry, clear } = await import("../registry");

beforeEach(() => {
  finished.length = 0;
  resetSinks();
});

describe("scheduled_per_row aggregate resolution (via runner statusOverride)", () => {
  it("aggregates success counts when all rows succeed", async () => {
    const rows = [1, 2, 3];
    let succeeded = 0;
    let failed = 0;

    await run({
      jobId: "host.test.prow.ok",
      kind: "scheduled_per_row",
      triggeredBy: "cron",
      handler: async () => {
        for (const _ of rows) succeeded += 1;
      },
      statusOverride: ({ thrown, timedOut, cancelled }) => {
        if (cancelled) return undefined;
        if (timedOut) {
          return {
            status: "timed_out",
            rowsTotal: rows.length,
            rowsSucceeded: succeeded,
            rowsFailed: failed,
          };
        }
        return {
          status: thrown ? "failed" : succeeded > 0 && failed > 0 ? "partial_failure" : "succeeded",
          rowsTotal: rows.length,
          rowsSucceeded: succeeded,
          rowsFailed: failed,
        };
      },
    });

    expect(finished.at(-1)?.status).toBe("succeeded");
    expect(finished.at(-1)?.rowsSucceeded).toBe(3);
    expect(finished.at(-1)?.rowsFailed).toBe(0);
  });

  it("marks partial_failure when some rows fail and some succeed", async () => {
    const rows = [1, 2, 3];
    let succeeded = 0;
    let failed = 0;

    await run({
      jobId: "host.test.prow.partial",
      kind: "scheduled_per_row",
      triggeredBy: "cron",
      handler: async () => {
        for (const r of rows) {
          if (r === 2) failed += 1;
          else succeeded += 1;
        }
      },
      statusOverride: () => ({
        status: failed > 0 && succeeded > 0 ? "partial_failure" : "succeeded",
        rowsTotal: rows.length,
        rowsSucceeded: succeeded,
        rowsFailed: failed,
      }),
    });

    expect(finished.at(-1)?.status).toBe("partial_failure");
    expect(finished.at(-1)?.rowsSucceeded).toBe(2);
    expect(finished.at(-1)?.rowsFailed).toBe(1);
  });
});

describe("scheduled_per_row per-row timeout cancellation (#910)", () => {
  it("aborts the timed-out row handler before starting the next row", async () => {
    clear();
    const jobId = "host.test.prow.timeout";
    // Row 1 hangs past its per-row timeout; row 2 records whether row 1 was still live.
    let row1Aborted = false;
    let row2StartedWhileRow1Live = false;
    let row1Settled = false;

    registerScheduledPerRow<number>({
      id: jobId,
      name: "prow timeout",
      schedule: "* * * * *",
      adminTriggerable: true,
      perRowTimeoutSec: 0.05,
      rowSource: async () => [1, 2],
      handler: async (ctx, row) => {
        if (row === 1) {
          await new Promise<void>((resolve) => {
            ctx.abortSignal.addEventListener("abort", () => {
              row1Aborted = true;
              row1Settled = true;
              resolve();
            });
          });
          return;
        }
        // Row 2 must not begin until row 1 has stopped racing (fix threads a per-row
        // signal so the timed-out handler is cancelled, not left running concurrently).
        if (!row1Settled) row2StartedWhileRow1Live = true;
      },
    });

    const entry = findEntry(jobId);
    await entry?.triggerFromApi?.(undefined, { triggeredBy: "admin", requestId: "r" });

    expect(row1Aborted).toBe(true);
    expect(row2StartedWhileRow1Live).toBe(false);
    expect(finished.at(-1)?.rowsFailed).toBe(1);
  });
});
