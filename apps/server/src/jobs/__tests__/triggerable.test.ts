import { describe, it, expect, beforeEach, vi } from "vite-plus/test";
import { resetSinks } from "../../diagnostics/capture";

vi.mock("../../notifications/emit", () => ({
  emit: async () => undefined,
}));

vi.mock("../history", () => ({
  startRun: async () => undefined,
  finishRun: async () => undefined,
  recordSkipped: async () => undefined,
  latestRun: async () => null,
  recentRuns: async () => [],
  pruneSuccessfulRuns: async () => 0,
}));

vi.mock("../config", () => ({
  getConfig: async (jobId: string) => ({
    jobId,
    enabled: true,
    scheduleOverride: null,
  }),
  updateConfig: async () => ({
    jobId: "x",
    enabled: true,
    scheduleOverride: null,
  }),
  effectiveSchedule: (d: string | undefined) => d,
}));

const { registerTriggerable } = await import("../triggerable");
const registry = await import("../registry");

beforeEach(() => {
  registry.clear();
  resetSinks();
});

describe("registerTriggerable", () => {
  it("runs the handler and returns the handler's result", async () => {
    const handle = registerTriggerable<{ x: number }, { y: number }>({
      id: "feature.test.double",
      name: "Test Job",
      requiredPermission: "admin:jobs",
      handler: async (_ctx, input) => ({ y: (input?.x ?? 0) * 2 }),
    });
    const out = await handle.trigger({ x: 21 }, { triggeredBy: "admin" });
    expect(out.result).toEqual({ y: 42 });
  });

  it("rejects bad input before invoking the handler", async () => {
    const handle = registerTriggerable<{ name: string }>({
      id: "feature.test.validated",
      name: "Test Job",
      requiredPermission: "admin:jobs",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
      handler: async () => undefined,
    });
    await expect(
      handle.trigger({} as { name: string }, { triggeredBy: "admin" }),
    ).rejects.toMatchObject({ code: "job.bad_input" });
  });

  it("returns job.already_running when scopeless and already running", async () => {
    const handle = registerTriggerable({
      id: "feature.test.slow",
      name: "Test Job",
      requiredPermission: "admin:jobs",
      handler: async () => {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 30);
        });
      },
    });
    const first = handle.trigger(null, { triggeredBy: "admin" });
    await expect(handle.trigger(null, { triggeredBy: "admin" })).rejects.toMatchObject({
      code: "job.already_running",
    });
    await first;
  });

  it("runs in parallel for different scope keys", async () => {
    let activeCount = 0;
    let maxActive = 0;
    const handle = registerTriggerable<{ id: string }>({
      id: "feature.test.scoped",
      name: "Test Job",
      requiredPermission: "admin:jobs",
      scopeKey: (input) => input.id,
      handler: async () => {
        activeCount += 1;
        maxActive = Math.max(maxActive, activeCount);
        await new Promise<void>((r) => setTimeout(r, 20));
        activeCount -= 1;
      },
    });
    await Promise.all([
      handle.trigger({ id: "a" }, { triggeredBy: "admin" }),
      handle.trigger({ id: "b" }, { triggeredBy: "admin" }),
    ]);
    expect(maxActive).toBe(2);
  });
});
