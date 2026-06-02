import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

// The `watchlist_items` write events live in media (design §M.2). Watchlist can
// only reach them through the media barrel, which would drag the full media
// module graph (db/client → env) into this isolated registration unit test, so
// stub the barrel down to the two constants + schemas the handler subscribes to.
vi.mock("../../media", () => ({
  WATCHLIST_EVENTS: {
    ITEM_ADDED: "watchlist.itemAdded",
    ITEM_REMOVED: "watchlist.itemRemoved",
  },
  watchlistItemAddedSchema: {},
  watchlistItemRemovedSchema: {},
}));

const { WATCHLIST_EVENTS } = await import("../../media");

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
const { invalidateMoodSummary } = await import("../moods/cluster");
const { invalidateTonightSection } = await import("../tonight/section");
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
    expect(invalidateTonightSection).toHaveBeenCalledWith("u1");
    expect(invalidateMoodSummary).toHaveBeenCalledWith("u1");
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
