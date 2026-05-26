import { describe, expect, it } from "vite-plus/test";
import {
  isActiveContinueWatchingEntry,
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
});
