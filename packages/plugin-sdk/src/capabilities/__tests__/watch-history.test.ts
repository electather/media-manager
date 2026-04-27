import { describe, it, expect } from "vite-plus/test";
import { WatchHistoryV1 } from "../watch-history";

describe("WatchHistoryV1", () => {
  it("is a user-scoped aggregate capability at v1", () => {
    expect(WatchHistoryV1.id).toBe("watchHistory");
    expect(WatchHistoryV1.version).toBe("v1");
    expect(WatchHistoryV1.scope).toBe("user");
    expect(WatchHistoryV1.strategy.kind).toBe("aggregate");
  });

  describe("getHistory output", () => {
    it("requires watchedAt on history entries", () => {
      const r = WatchHistoryV1.methods.getHistory.output.safeParse([
        {
          item: {
            id: "movie:1",
            title: "x",
            year: 2020,
            type: "movie",
            rating: null,
            posterUrl: null,
          },
          // watchedAt missing
        },
      ]);
      expect(r.success).toBe(false);
    });

    it("accepts a valid history entry", () => {
      const r = WatchHistoryV1.methods.getHistory.output.safeParse([
        {
          item: {
            id: "movie:1",
            title: "x",
            year: 2020,
            type: "movie",
            rating: null,
            posterUrl: null,
          },
          watchedAt: "2026-01-01T00:00:00.000Z",
        },
      ]);
      expect(r.success).toBe(true);
    });
  });

  describe("getInProgress", () => {
    it("is marked optional", () => {
      expect(WatchHistoryV1.methods.getInProgress.optional).toBe(true);
    });
  });

  describe("addToHistory", () => {
    it("invalidates watchHistory@v1", () => {
      expect(WatchHistoryV1.methods.addToHistory.invalidates).toEqual(["watchHistory@v1"]);
    });
  });
});
