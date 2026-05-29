import { describe, expect, it } from "vite-plus/test";
import {
  extractTmdbId,
  FINISHING_THRESHOLD,
  isActiveContinueWatchingEntry,
  isFinishing,
  projectContinueWatchingProgress,
  projectProgressMapEntry,
} from "../progress";

describe("continue watching progress helpers", () => {
  it("treats entries with positive progress and unknown duration as active only", () => {
    const entry = {
      progressMs: 30_000,
      item: { type: "movie", ids: { tmdb: "11" } },
    };

    expect(isActiveContinueWatchingEntry(entry)).toBe(true);
    expect(projectContinueWatchingProgress(entry)).toBeNull();
    expect(projectProgressMapEntry(entry)).toBeNull();
  });

  it("projects measurable active progress into watchlist progress entries", () => {
    const entry = {
      progressMs: 30_000,
      item: { type: "movie", durationSec: 120, ids: { tmdb: "11" } },
    };

    expect(isActiveContinueWatchingEntry(entry)).toBe(true);
    expect(projectContinueWatchingProgress(entry)).toEqual({ watched: 30, total: 120 });
    expect(projectProgressMapEntry(entry)).toEqual({
      id: "movie:11",
      entry: { watched: 30, total: 120 },
    });
  });

  it("filters entries at the shared finishing threshold", () => {
    const entry = {
      progressMs: 102_000,
      item: { type: "show", durationSec: 120, ids: { tmdb_id: "22" } },
    };

    expect(isActiveContinueWatchingEntry(entry)).toBe(false);
    expect(projectContinueWatchingProgress(entry)).toBeNull();
    expect(projectProgressMapEntry(entry)).toBeNull();
  });

  it("re-applies the threshold after rounding so projections match the prior rounded-ratio behaviour", () => {
    // 101_500ms / 120s = 0.8458 (under the ms-ratio threshold) but rounds to 102s → 0.85 (at threshold).
    // The watchlist projection must exclude this entry to preserve the pre-refactor classification.
    const entry = {
      progressMs: 101_500,
      item: { type: "movie", durationSec: 120, ids: { tmdb: "33" } },
    };

    expect(isActiveContinueWatchingEntry(entry)).toBe(true);
    expect(projectContinueWatchingProgress(entry)).toBeNull();
    expect(projectProgressMapEntry(entry)).toBeNull();
  });
});

describe("canonical shared domain utils", () => {
  // These are the single definitions home/watchlist will import once the
  // duplicate copies are deleted (US-024) — the tests pin the behaviour the
  // four prior sites must agree on.
  describe("isFinishing", () => {
    it("is true once watched reaches the 85% threshold so the four sites mark finishing alike", () => {
      expect(isFinishing({ watched: 85, total: 100 })).toBe(true);
      expect(isFinishing({ watched: 90, total: 100 })).toBe(true);
    });

    it("is false below the threshold", () => {
      expect(isFinishing({ watched: 84, total: 100 })).toBe(false);
    });

    it("is false for a non-positive total instead of dividing by zero", () => {
      expect(isFinishing({ watched: 10, total: 0 })).toBe(false);
    });

    it("shares the same cutoff constant as the projection path", () => {
      expect(FINISHING_THRESHOLD).toBe(0.85);
      expect(isFinishing({ watched: Math.ceil(FINISHING_THRESHOLD * 100), total: 100 })).toBe(true);
    });
  });

  describe("extractTmdbId", () => {
    it("probes ids.tmdb, then ids.tmdb_id, then a top-level tmdbId in order", () => {
      expect(extractTmdbId({ ids: { tmdb: "10" } })).toBe("10");
      expect(extractTmdbId({ ids: { tmdb_id: "20" } })).toBe("20");
      expect(extractTmdbId({ tmdbId: "30" })).toBe("30");
      expect(extractTmdbId({ ids: { tmdb: "10" }, tmdbId: "30" })).toBe("10");
    });

    it("returns null for non-object or id-less payloads so divergent callers collapse onto one probe", () => {
      expect(extractTmdbId(null)).toBeNull();
      expect(extractTmdbId("nope")).toBeNull();
      expect(extractTmdbId({ ids: { tmdb: 42 } })).toBeNull();
      expect(extractTmdbId({})).toBeNull();
    });
  });
});
