import { describe, it, expect, beforeEach, vi } from "vite-plus/test";
import { resetSinks } from "../../diagnostics/capture";
import type { emit as emitFn } from "../../notifications/emit";

type EmitArg = Parameters<typeof emitFn>[0];

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

const emitMock = vi.fn<(event: EmitArg) => Promise<void>>(async () => undefined);

vi.mock("../../notifications/emit", () => ({
  emit: emitMock,
}));

const { run } = await import("../runner");

function getEmittedEvent(index: number): EmitArg {
  const call = emitMock.mock.calls[index];
  if (!call) throw new Error(`expected emit call at index ${index}`);
  return call[0];
}

beforeEach(() => {
  emitMock.mockClear();
  resetSinks();
});

describe("runner notification emit hook", () => {
  it("emits job.run.failed on failure with admin audience", async () => {
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
    expect(event.type).toBe("job.run.failed");
    expect(event.category).toBe("system");
    expect(event.severity).toBe("error");
    expect(event.audience).toEqual({ kind: "admin", permission: "admin:server" });
    expect(event.payload).toMatchObject({
      jobId: "host.test.fail",
      error: "boom",
    });
    expect((event.payload as { runId?: string }).runId).toBeTruthy();
  });

  it("emits job.run.failed on timed_out", async () => {
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
    expect(getEmittedEvent(0).type).toBe("job.run.failed");
  });

  it("emits job.run.failed on partial_failure via statusOverride", async () => {
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
    expect(getEmittedEvent(0).type).toBe("job.run.failed");
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

  it("emits connection.sync.succeeded when sync job succeeds with triggeredByUserId", async () => {
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
    expect(event.type).toBe("connection.sync.succeeded");
    expect(event.audience).toEqual({ kind: "user", userId: "user-1" });
    expect(event.payload).toEqual({
      connectionId: "conn-42",
      pluginId: "seerr",
      itemCount: 3,
    });
  });

  it("does not emit connection.sync.succeeded when triggeredByUserId is null", async () => {
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
