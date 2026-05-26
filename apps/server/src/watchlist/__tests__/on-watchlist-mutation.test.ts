import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { WATCHLIST_EVENTS } from "../events";

vi.mock("../../jobs/events", () => ({
  on: vi.fn(),
}));

vi.mock("../moods/cluster", () => ({
  invalidateMoodSummary: vi.fn(),
}));

vi.mock("../tonight/section", () => ({
  invalidateTonightSection: vi.fn(),
}));

vi.mock("../service", () => ({
  invalidateCounts: vi.fn(),
}));

const { on } = await import("../../jobs/events");
const { invalidateMoodSummary } = await import("../moods/cluster");
const { invalidateTonightSection } = await import("../tonight/section");
const { invalidateCounts } = await import("../service");
const { __resetRegistration, register } = await import("../jobs/on-watchlist-mutation");

beforeEach(() => {
  __resetRegistration();
  vi.clearAllMocks();
});

describe("watchlist mutation job registration", () => {
  it("registers mutation invalidators for itemAdded and itemRemoved", () => {
    register();

    expect(on).toHaveBeenCalledTimes(2);
    expect(on).toHaveBeenCalledWith(
      WATCHLIST_EVENTS.ITEM_ADDED,
      expect.anything(),
      expect.any(Function),
    );
    expect(on).toHaveBeenCalledWith(
      WATCHLIST_EVENTS.ITEM_REMOVED,
      expect.anything(),
      expect.any(Function),
    );
  });

  it("invalidates every watchlist summary cache for the mutated user", async () => {
    register();

    const handlers = vi.mocked(on).mock.calls.map((call) => call[2]);
    for (const handler of handlers) {
      await handler({ userId: "u1", key: "movie:1", source: "manual", createdAt: 1 });
    }

    expect(invalidateTonightSection).toHaveBeenCalledTimes(2);
    expect(invalidateMoodSummary).toHaveBeenCalledTimes(2);
    expect(invalidateCounts).toHaveBeenCalledTimes(2);
    expect(invalidateTonightSection).toHaveBeenCalledWith("u1");
    expect(invalidateMoodSummary).toHaveBeenCalledWith("u1");
    expect(invalidateCounts).toHaveBeenCalledWith("u1");
  });

  it("re-registers listeners after idempotency guard is reset", () => {
    register();

    expect(on).toHaveBeenCalledTimes(2);
    expect(on).toHaveBeenCalledWith(
      WATCHLIST_EVENTS.ITEM_ADDED,
      expect.anything(),
      expect.any(Function),
    );
    expect(on).toHaveBeenCalledWith(
      WATCHLIST_EVENTS.ITEM_REMOVED,
      expect.anything(),
      expect.any(Function),
    );
  });
});
