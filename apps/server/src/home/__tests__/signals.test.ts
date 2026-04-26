import { describe, it, expect, vi, beforeEach } from "vite-plus/test";

// Stub the env so transitively imported db/client doesn't throw at module
// load time. Tests below mock the actual DB query surface so no real driver
// is constructed.
vi.mock("../../env", () => ({
  env: {
    CACHE_PROVIDER: "memory",
    ENCRYPTION_KEY: "test-key",
    SQLITE_PATH: "file::memory:",
    BETTER_AUTH_SECRET: "x".repeat(32),
    BETTER_AUTH_URL: "http://localhost",
    APP_EXTERNAL_URL: "http://localhost",
  },
}));

interface PendingRows<T> {
  rows: T[];
}

const profileRows: PendingRows<{ confidence: string }> = { rows: [] };
const feedbackRows: PendingRows<{
  mediaType: "movie" | "tv";
  tmdbId: string;
  action: string;
  rating: number | null;
}>[] = [{ rows: [] }, { rows: [] }];
let feedbackCallIndex = 0;

/**
 * Branches on the `where().limit()` vs `where().orderBy().limit()` pattern.
 * `signals.ts`'s profile query uses `where().limit()` (no orderBy); both
 * feedback queries use `where().orderBy().limit()`. The mock therefore
 * routes by builder shape rather than fragile table-name introspection.
 */
vi.mock("../../db/client", () => ({
  getDb: () => ({
    select(_args?: unknown) {
      return {
        from(_table: unknown) {
          return {
            where: () => ({
              orderBy: () => ({
                limit: () => ({
                  all: async () => {
                    const target = feedbackRows[feedbackCallIndex] ?? { rows: [] };
                    feedbackCallIndex = Math.min(feedbackCallIndex + 1, feedbackRows.length);
                    return target.rows;
                  },
                }),
              }),
              limit: () => ({
                all: async () => profileRows.rows,
              }),
            }),
          };
        },
      };
    },
  }),
}));

import { captureSignals } from "../signals";

const baseLoader = {
  hasPlugin: vi.fn<(cap: string) => Promise<boolean>>(async () => false),
  getInProgressSet: vi.fn<() => Promise<Set<string>>>(async () => new Set<string>()),
};

const baseMedia = {
  getWatchlistCount: vi.fn<() => Promise<number>>(async () => 0),
  getCalendarProgressCount: vi.fn<() => Promise<number>>(async () => 0),
  getDetails: vi.fn<(id: string, type?: "movie" | "tv") => Promise<unknown>>(async () => null),
};

beforeEach(() => {
  profileRows.rows = [];
  feedbackRows[0]!.rows = [];
  feedbackRows[1]!.rows = [];
  feedbackCallIndex = 0;
  baseLoader.hasPlugin.mockReset().mockResolvedValue(false);
  baseLoader.getInProgressSet.mockReset().mockResolvedValue(new Set());
  baseMedia.getWatchlistCount.mockReset().mockResolvedValue(0);
  baseMedia.getCalendarProgressCount.mockReset().mockResolvedValue(0);
  baseMedia.getDetails.mockReset().mockResolvedValue(null);
});

function buildArgs() {
  return {
    userId: "u1",
    mediaService: baseMedia as unknown as Parameters<typeof captureSignals>[0]["mediaService"],
    loader: baseLoader as unknown as Parameters<typeof captureSignals>[0]["loader"],
  };
}

describe("captureSignals", () => {
  it("returns conservative defaults when nothing is set up", async () => {
    const signals = await captureSignals(buildArgs());
    expect(signals.profileConfidence).toBe("none");
    expect(signals.recentSeed).toBeNull();
    expect(signals.inProgressCount).toBe(0);
    expect(signals.watchlistCount).toBe(0);
  });

  it("reads profile confidence from preference_profiles", async () => {
    profileRows.rows = [{ confidence: "high" }];
    const signals = await captureSignals(buildArgs());
    expect(signals.profileConfidence).toBe("high");
  });

  it("falls back to 'none' when stored confidence is unknown", async () => {
    profileRows.rows = [{ confidence: "very-confident" }];
    const signals = await captureSignals(buildArgs());
    expect(signals.profileConfidence).toBe("none");
  });

  it("emits a recentSeed from the primary 30d window when a like exists", async () => {
    feedbackRows[0]!.rows = [{ mediaType: "movie", tmdbId: "550", action: "like", rating: null }];
    baseMedia.getDetails.mockResolvedValue({ title: "Fight Club" });
    const signals = await captureSignals(buildArgs());
    expect(signals.recentSeed).toEqual({
      id: "movie:550",
      tmdbId: "550",
      mediaType: "movie",
      title: "Fight Club",
      reason: "liked",
    });
  });

  it("falls back to recently_completed seed when nothing in primary window", async () => {
    feedbackRows[0]!.rows = [];
    feedbackRows[1]!.rows = [{ mediaType: "tv", tmdbId: "1396", action: "rate", rating: 6 }];
    baseMedia.getDetails.mockResolvedValue({ title: "Breaking Bad" });
    const signals = await captureSignals(buildArgs());
    expect(signals.recentSeed?.reason).toBe("recently_completed");
  });

  it("returns null seed when both windows are empty", async () => {
    const signals = await captureSignals(buildArgs());
    expect(signals.recentSeed).toBeNull();
  });

  it("counts inProgress only when watchHistory plugin is present", async () => {
    baseLoader.hasPlugin.mockImplementation(async (cap: string) => cap === "watchHistory@v1");
    baseLoader.getInProgressSet.mockResolvedValue(new Set(["movie:1", "movie:2"]));
    const signals = await captureSignals(buildArgs());
    expect(signals.hasWatchHistoryPlugin).toBe(true);
    expect(signals.inProgressCount).toBe(2);
  });

  it("defaults a failing partial signal to zero", async () => {
    baseLoader.hasPlugin.mockImplementation(async (cap: string) => cap === "watchlist@v1");
    baseMedia.getWatchlistCount.mockRejectedValue(new Error("boom"));
    const signals = await captureSignals(buildArgs());
    expect(signals.watchlistCount).toBe(0);
  });

  it("falls back to a tmdb placeholder title when getDetails fails", async () => {
    feedbackRows[0]!.rows = [{ mediaType: "movie", tmdbId: "999", action: "like", rating: null }];
    baseMedia.getDetails.mockRejectedValue(new Error("upstream"));
    const signals = await captureSignals(buildArgs());
    expect(signals.recentSeed?.title).toBe("tmdb:999");
  });
});
