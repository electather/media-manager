import { describe, it, expect, beforeEach, vi } from "vite-plus/test";
import { resetErrorSinks } from "../../errors/capture";

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

const { registerCoalesced } = await import("../coalesced");
const registry = await import("../registry");

beforeEach(() => {
  registry.clear();
  resetErrorSinks();
});

describe("registerCoalesced", () => {
  it("collapses a burst into a single run with the correct trigger count", async () => {
    let invocations = 0;
    let seenCount = 0;
    const handle = registerCoalesced({
      id: "feature.test.coalesce",
      name: "Test Job",

      debounceMs: 20,
      scopeKey: (input) => (input as { scopeKey: string }).scopeKey,
      handler: async (_ctx, triggerCount) => {
        invocations += 1;
        seenCount = triggerCount;
      },
    });

    handle.trigger({ scopeKey: "u1" });
    handle.trigger({ scopeKey: "u1" });
    handle.trigger({ scopeKey: "u1" });
    await new Promise((r) => setTimeout(r, 80));

    expect(invocations).toBe(1);
    expect(seenCount).toBe(3);
  });

  it("coalesces independently per scope key", async () => {
    const seen = new Map<string, number>();
    const handle = registerCoalesced({
      id: "feature.test.coalesce.scoped",
      name: "Test Job",

      debounceMs: 15,
      scopeKey: (input) => (input as { scopeKey: string }).scopeKey,
      handler: async (ctx, triggerCount) => {
        // Pull scope key out of run id isn't available; the test reconstructs via closure.
        seen.set(ctx.runId, triggerCount);
      },
    });

    handle.trigger({ scopeKey: "alice" });
    handle.trigger({ scopeKey: "bob" });
    handle.trigger({ scopeKey: "alice" });
    await new Promise((r) => setTimeout(r, 80));

    const counts = Array.from(seen.values()).sort((a, b) => a - b);
    expect(counts).toEqual([1, 2]);
  });
});
