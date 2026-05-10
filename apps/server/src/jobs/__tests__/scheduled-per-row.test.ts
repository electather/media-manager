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

const { run } = await import("../runner");

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
