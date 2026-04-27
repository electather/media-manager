import { describe, it, expect } from "vite-plus/test";
import { ContinueWatchingV1 } from "../continue-watching";
import { getCapability } from "../index";

const libraryItemFixture = {
  id: "plex:12345",
  title: "Example Movie",
  type: "movie" as const,
  playerLink: "plex://server/12345",
  addedAt: "2026-04-20T10:00:00.000Z",
};

describe("ContinueWatchingV1", () => {
  it("registers as a user-scoped aggregate capability at v1", () => {
    expect(ContinueWatchingV1.version).toBe("v1");
    expect(ContinueWatchingV1.scope).toBe("user");
    expect(getCapability("continueWatching", "v1")).toBe(ContinueWatchingV1);
  });

  it("exposes only getContinueWatching", () => {
    expect(Object.keys(ContinueWatchingV1.methods)).toEqual(["getContinueWatching"]);
  });

  describe("getContinueWatching input", () => {
    it("accepts no filters", () => {
      const r = ContinueWatchingV1.methods.getContinueWatching.input.safeParse({});
      expect(r.success).toBe(true);
    });

    it("accepts a type filter and limit", () => {
      const r = ContinueWatchingV1.methods.getContinueWatching.input.safeParse({
        type: "show",
        limit: 10,
      });
      expect(r.success).toBe(true);
    });

    it("rejects episode as a query type", () => {
      const r = ContinueWatchingV1.methods.getContinueWatching.input.safeParse({ type: "episode" });
      expect(r.success).toBe(false);
    });
  });

  describe("getContinueWatching output", () => {
    it("accepts entries with a nextUp episode", () => {
      const r = ContinueWatchingV1.methods.getContinueWatching.output.safeParse([
        {
          item: { ...libraryItemFixture, type: "episode", season: 1, episode: 2 },
          progressMs: 320_000,
          nextUp: {
            ...libraryItemFixture,
            id: "plex:12346",
            type: "episode",
            season: 1,
            episode: 3,
          },
          lastPlayedAt: "2026-04-22T20:00:00.000Z",
        },
      ]);
      expect(r.success).toBe(true);
    });

    it("accepts entries without progress (start next episode)", () => {
      const r = ContinueWatchingV1.methods.getContinueWatching.output.safeParse([
        { item: libraryItemFixture },
      ]);
      expect(r.success).toBe(true);
    });

    it("rejects entries missing item", () => {
      const r = ContinueWatchingV1.methods.getContinueWatching.output.safeParse([
        { progressMs: 1000 },
      ]);
      expect(r.success).toBe(false);
    });
  });
});
