import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { CoalescedJobHandle } from "../../jobs/types";

vi.mock("../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

vi.mock("../../jobs/triggerable", () => ({
  registerTriggerable: vi.fn(),
}));

vi.mock("../../jobs/scheduled-per-row", () => ({
  registerScheduledPerRow: vi.fn(),
}));

const handleTriggerMock = vi.fn();
const fakeHandle: CoalescedJobHandle = {
  id: "host.preference.incremental_update",
  name: "Incremental preference update",
  description: "test",
  kind: "coalesced",
  enabled: true,
  adminTriggerable: false,
  userTriggerable: false,
  trigger: handleTriggerMock,
};
vi.mock("../../jobs/coalesced", () => ({
  registerCoalesced: vi.fn(() => fakeHandle),
}));

vi.mock("../service", () => ({
  getPreferencesService: vi.fn(() => ({ applyIncrementalUpdate: vi.fn() })),
}));

vi.mock("../../catalog", async () => {
  const actual = await vi.importActual<typeof import("../../catalog")>("../../catalog");
  return {
    ...actual,
    getCatalogService: vi.fn(() => ({})),
    writeRecommendationsForUser: vi.fn(async () => undefined),
  };
});

const consolaMock = {
  info: vi.fn(),
  warn: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};
vi.mock("consola", () => ({ default: consolaMock, consola: consolaMock }));

const { registerJobs } = await import("../jobs");
const { triggerIncremental, resetIncrementalHandleForTest } =
  await import("../jobs/incremental-handle");

/**
 * Regression for the pre-Phase-3a silent-no-op bug: `ent_feedback` previously
 * cast the `RegistryEntry` returned by `find(jobId)` to `{ trigger? }` and
 * called `trigger(...)`. The registry entry never carries `trigger` — only the
 * `CoalescedJobHandle` returned by `registerCoalesced` does — so every
 * incremental update was silently dropped. These tests pin that
 * `registerJobs()` captures the handle into the leaf module and that
 * `triggerIncremental()` actually invokes the underlying handle.
 */
describe("incremental trigger handle capture", () => {
  beforeEach(() => {
    resetIncrementalHandleForTest();
    handleTriggerMock.mockReset();
  });

  it("triggers no-op before registerJobs runs (cold worker / startup race)", () => {
    triggerIncremental("u-cold");
    expect(handleTriggerMock).not.toHaveBeenCalled();
  });

  it("routes through the CoalescedJobHandle returned by registerCoalesced", () => {
    registerJobs();
    triggerIncremental("u-42");
    expect(handleTriggerMock).toHaveBeenCalledExactlyOnceWith({
      scopeKey: "u-42",
      userId: "u-42",
    });
  });

  it("resetIncrementalHandleForTest clears the captured handle", () => {
    registerJobs();
    triggerIncremental("u-1");
    expect(handleTriggerMock).toHaveBeenCalledTimes(1);

    resetIncrementalHandleForTest();
    handleTriggerMock.mockClear();
    triggerIncremental("u-2");
    expect(handleTriggerMock).not.toHaveBeenCalled();
  });
});
