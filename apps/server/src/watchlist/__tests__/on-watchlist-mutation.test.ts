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

const { on } = await import("../../jobs/events");
const { __resetRegistration, register } = await import("../jobs/on-watchlist-mutation");

beforeEach(() => {
  __resetRegistration();
  vi.mocked(on).mockClear();
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
