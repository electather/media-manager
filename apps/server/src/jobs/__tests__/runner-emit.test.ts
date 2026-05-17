import { describe, it, expect, beforeEach, vi } from "vite-plus/test";
import { resetSinks } from "../../diagnostics/capture";

vi.mock("../history", () => ({
  startRun: async () => undefined,
  finishRun: async () => undefined,
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

const emitMock = vi.fn<(name: string, schema: unknown, payload: unknown) => Promise<void>>(
  async () => undefined,
);

vi.mock("../emit", () => ({
  emit: emitMock,
}));

const { run } = await import("../runner");

function getEmittedEvent(index: number): { name: string; payload: Record<string, unknown> } {
  const call = emitMock.mock.calls[index];
  if (!call) throw new Error(`expected emit call at index ${index}`);
  return { name: call[0] as string, payload: call[2] as Record<string, unknown> };
}

beforeEach(() => {
  emitMock.mockClear();
  resetSinks();
});

describe("runner typed-event hook", () => {
  it("emits jobs.run.failed on failure", async () => {
    await run({
      jobId: "host.test.fail",
      kind: "scheduled",
      triggeredBy: "cron",
      handler: async () => {
        throw new Error("boom");
      },
    });

    expect(emitMock).toHaveBeenCalledTimes(1);
    const event = getEmittedEvent(0);
    expect(event.name).toBe("jobs.run.failed");
    expect(event.payload).toMatchObject({
      jobId: "host.test.fail",
      status: "failed",
      error: "boom",
    });
    expect(event.payload.runId).toBeTruthy();
  });

  it("emits jobs.run.failed on timed_out", async () => {
    await run({
      jobId: "host.test.timeout",
      kind: "scheduled",
      triggeredBy: "cron",
      timeoutSec: 0.001,
      handler: async () => {
        await new Promise((r) => setTimeout(r, 50));
      },
    });

    expect(emitMock).toHaveBeenCalledTimes(1);
    expect(getEmittedEvent(0).name).toBe("jobs.run.failed");
  });

  it("emits jobs.run.failed on partial_failure via statusOverride", async () => {
    await run({
      jobId: "host.test.partial",
      kind: "scheduled_per_row",
      triggeredBy: "cron",
      handler: async () => undefined,
      statusOverride: () => ({
        status: "partial_failure",
        rowsTotal: 2,
        rowsSucceeded: 1,
        rowsFailed: 1,
      }),
    });

    expect(emitMock).toHaveBeenCalledTimes(1);
    expect(getEmittedEvent(0).name).toBe("jobs.run.failed");
  });

  it("does not emit on success when not sync-classified", async () => {
    await run({
      jobId: "host.test.ok",
      kind: "scheduled",
      triggeredBy: "cron",
      handler: async () => undefined,
    });

    expect(emitMock).not.toHaveBeenCalled();
  });

  it("emits jobs.sync.succeeded when sync job succeeds with triggeredByUserId", async () => {
    await run({
      jobId: "plugin.seerr.requestStatusSync",
      kind: "scheduled_per_row",
      triggeredBy: "user",
      triggeredByUserId: "user-1",
      scopeKey: "conn-42",
      handler: async () => undefined,
      statusOverride: () => ({
        status: "succeeded",
        rowsTotal: 3,
        rowsSucceeded: 3,
        rowsFailed: 0,
      }),
    });

    expect(emitMock).toHaveBeenCalledTimes(1);
    const event = getEmittedEvent(0);
    expect(event.name).toBe("jobs.sync.succeeded");
    expect(event.payload).toMatchObject({
      jobId: "plugin.seerr.requestStatusSync",
      connectionId: "conn-42",
      pluginId: "seerr",
      itemCount: 3,
      triggeredByUserId: "user-1",
    });
  });

  it("does not emit jobs.sync.succeeded when triggeredByUserId is null", async () => {
    await run({
      jobId: "plugin.seerr.requestStatusSync",
      kind: "scheduled_per_row",
      triggeredBy: "cron",
      handler: async () => undefined,
      statusOverride: () => ({
        status: "succeeded",
        rowsTotal: 1,
        rowsSucceeded: 1,
        rowsFailed: 0,
      }),
    });

    expect(emitMock).not.toHaveBeenCalled();
  });

  it("emit failure does not propagate to host operation", async () => {
    emitMock.mockRejectedValueOnce(new Error("emit boom"));

    await expect(
      run({
        jobId: "host.test.emit-throws",
        kind: "scheduled",
        triggeredBy: "cron",
        handler: async () => {
          throw new Error("handler boom");
        },
      }),
    ).resolves.toMatchObject({ status: "failed" });
  });
});
