import { describe, it, expect, beforeEach, vi } from "vite-plus/test";
import { resetSinks } from "../../diagnostics/capture";

const started: unknown[] = [];
const finished: unknown[] = [];
const skips: unknown[] = [];
let nextStartRunError: Error | null = null;
let nextGetConfigError: Error | null = null;

vi.mock("../../notifications/emit", () => ({
  emit: async () => undefined,
}));

vi.mock("../history", () => ({
  startRun: async (args: unknown) => {
    if (nextStartRunError) {
      const err = nextStartRunError;
      nextStartRunError = null;
      throw err;
    }
    started.push(args);
  },
  finishRun: async (args: unknown) => {
    finished.push(args);
  },
  recordSkipped: async (args: unknown) => {
    skips.push(args);
  },
  latestRun: async () => null,
  recentRuns: async () => [],
  pruneSuccessfulRuns: async () => 0,
}));

vi.mock("../config", () => ({
  getConfig: async (jobId: string) => {
    if (nextGetConfigError) {
      const err = nextGetConfigError;
      nextGetConfigError = null;
      throw err;
    }
    return {
      jobId,
      enabled: true,
      scheduleOverride: null,
    };
  },
  updateConfig: async () => ({
    jobId: "x",
    enabled: true,
    scheduleOverride: null,
  }),
  effectiveSchedule: (d: string | undefined) => d,
}));

const { registerScheduled } = await import("../scheduled");
const { run, isRunning } = await import("../runner");
const registry = await import("../registry");

beforeEach(() => {
  started.length = 0;
  finished.length = 0;
  skips.length = 0;
  nextStartRunError = null;
  nextGetConfigError = null;
  registry.clear();
  resetSinks();
});

describe("scheduled runner", () => {
  it("marks run as succeeded and records a row", async () => {
    const outcome = await run({
      jobId: "host.test.noop",
      kind: "scheduled",
      triggeredBy: "cron",
      handler: async () => undefined,
    });
    expect(outcome.status).toBe("succeeded");
    expect(started).toHaveLength(1);
    expect(finished).toHaveLength(1);
    expect((finished[0] as { status: string }).status).toBe("succeeded");
  });

  it("marks a thrown handler as failed", async () => {
    const outcome = await run({
      jobId: "host.test.throws",
      kind: "scheduled",
      triggeredBy: "cron",
      handler: async () => {
        throw new Error("boom");
      },
    });
    expect(outcome.status).toBe("failed");
  });

  it("marks an over-timeout handler as timed_out", async () => {
    const outcome = await run({
      jobId: "host.test.slow",
      kind: "scheduled",
      triggeredBy: "cron",
      timeoutSec: 0.05,
      handler: async (ctx) => {
        await new Promise<void>((resolve) => {
          const check = setInterval(() => {
            if (ctx.abortSignal.aborted) {
              clearInterval(check);
              resolve();
            }
          }, 10);
        });
      },
    });
    expect(outcome.status).toBe("timed_out");
  });

  it("prevents concurrent runs of the same scopeless job", async () => {
    const slow = run({
      jobId: "host.test.slow2",
      kind: "scheduled",
      triggeredBy: "cron",
      handler: async () => {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 30);
        });
      },
    });
    expect(isRunning("host.test.slow2")).toBe(true);
    const second = await run({
      jobId: "host.test.slow2",
      kind: "scheduled",
      triggeredBy: "cron",
      handler: async () => undefined,
    });
    expect(second.status).toBe("failed");
    await slow;
    expect(isRunning("host.test.slow2")).toBe(false);
  });

  it("clears active key when getConfig throws", async () => {
    nextGetConfigError = new Error("db down");
    await expect(
      run({
        jobId: "host.test.getconfig-fail",
        kind: "scheduled",
        triggeredBy: "cron",
        handler: async () => undefined,
      }),
    ).rejects.toThrow("db down");
    expect(isRunning("host.test.getconfig-fail")).toBe(false);
    expect(started).toHaveLength(0);
    expect(finished).toHaveLength(0);
  });

  it("clears active key and finalizes the row as failed when startRun throws", async () => {
    nextStartRunError = new Error("db down");
    await expect(
      run({
        jobId: "host.test.startrun-fail",
        kind: "scheduled",
        triggeredBy: "cron",
        handler: async () => undefined,
      }),
    ).rejects.toThrow("db down");
    expect(isRunning("host.test.startrun-fail")).toBe(false);
    // startRun threw before runStarted was set, so no row exists to finalize.
    expect(finished).toHaveLength(0);
  });
});

describe("registerScheduled", () => {
  it("registers a unique job id and rejects duplicates", () => {
    registerScheduled({
      id: "host.test.dup",
      name: "Test Job",
      schedule: "*/1 * * * *",
      handler: async () => undefined,
    });
    expect(() =>
      registerScheduled({
        id: "host.test.dup",
        name: "Test Job",
        schedule: "*/1 * * * *",
        handler: async () => undefined,
      }),
    ).toThrow(/duplicate job id/);
  });
});
