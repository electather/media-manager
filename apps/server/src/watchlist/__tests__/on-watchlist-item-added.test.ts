import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

// The `watchlist_items` write events live in media (design §M.2). Watchlist can
// only reach them through the media barrel, which would drag the full media
// module graph (db/client → env) into this isolated registration unit test, so
// stub the barrel down to the two constants + schemas the handlers subscribe to.
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
const { registerOnWatchlistItemAdded } = await import("../jobs/on-watchlist-item-added");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("on-watchlist-item-added", () => {
  it("registers one handler for the ITEM_ADDED event", () => {
    registerOnWatchlistItemAdded();

    expect(on).toHaveBeenCalledTimes(1);
    expect(on).toHaveBeenCalledWith(
      WATCHLIST_EVENTS.ITEM_ADDED,
      expect.anything(),
      expect.any(Function),
    );
  });

  it("invalidates Tonight section and mood-summary for the mutated user", async () => {
    registerOnWatchlistItemAdded();

    const handler = vi.mocked(on).mock.calls[0]![2];
    await handler({ userId: "u1", key: "movie:1", source: "manual", createdAt: 1 });

    expect(invalidateTonightSection).toHaveBeenCalledOnce();
    expect(invalidateMoodSummary).toHaveBeenCalledOnce();
    expect(invalidateTonightSection).toHaveBeenCalledWith("u1");
    expect(invalidateMoodSummary).toHaveBeenCalledWith("u1");
  });
});
