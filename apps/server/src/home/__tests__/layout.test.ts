/* eslint-disable @typescript-eslint/unbound-method --
 * Tests temporarily swap each row fetcher's `fetch` method on the registry
 * and restore the original after. The "unbound" pattern is intentional
 * here — captured as a value, never invoked detached.
 */

import { describe, it, expect, vi } from "vite-plus/test";
import { buildRowStubs, fetchHero, runFetch } from "../layout";
import { ROW_FETCHERS } from "../rows/index";
import { AllPluginsFailedError } from "../../media/errors";
import type { RowFetchContext } from "../rows/index";
import type { LayoutSignals } from "../signals";

/**
 * `runFetch` is the only place `FetchOutcome` is computed. Each branch is
 * tested directly so a future refactor doesn't accidentally mix
 * timeout/all-failed with ok-empty (the bug the rules.ts comment specifically
 * calls out as the motivation for testing this surface).
 */
describe("runFetch outcome classification", () => {
  it("classifies a non-empty fetch as ok_items", async () => {
    const original = ROW_FETCHERS.trendingNow.fetch;
    const ctx = makeStubCtx();
    ROW_FETCHERS.trendingNow.fetch = async () => ({
      items: [{ id: "movie:1", tmdbId: "1", mediaType: "movie", title: "x" }],
      cursor: null,
    });
    try {
      const row = await runFetch("trendingNow", ctx, { cursor: null, limit: 20 });
      expect(row.outcome).toBe("ok_items");
      expect(row.partial).toBeUndefined();
    } finally {
      ROW_FETCHERS.trendingNow.fetch = original;
    }
  });

  it("classifies an empty fetch with no peer errors as ok_empty", async () => {
    const original = ROW_FETCHERS.upcomingForYou.fetch;
    const ctx = makeStubCtx();
    ROW_FETCHERS.upcomingForYou.fetch = async () => ({ items: [], cursor: null });
    try {
      const row = await runFetch("upcomingForYou", ctx, { cursor: null, limit: 20 });
      expect(row.outcome).toBe("ok_empty");
    } finally {
      ROW_FETCHERS.upcomingForYou.fetch = original;
    }
  });

  it("classifies an empty fetch with peer errors as partial (overrides ok_empty)", async () => {
    const original = ROW_FETCHERS.upcomingForYou.fetch;
    const ctx = makeStubCtx();
    ROW_FETCHERS.upcomingForYou.fetch = async () => ({
      items: [],
      cursor: null,
      partial: true,
    });
    try {
      const row = await runFetch("upcomingForYou", ctx, { cursor: null, limit: 20 });
      expect(row.outcome).toBe("partial");
    } finally {
      ROW_FETCHERS.upcomingForYou.fetch = original;
    }
  });

  it("classifies an AllPluginsFailedError throw as all_failed", async () => {
    const original = ROW_FETCHERS.continueWatching.fetch;
    const ctx = makeStubCtx();
    ROW_FETCHERS.continueWatching.fetch = async () => {
      throw new AllPluginsFailedError("watchHistory@v1", []);
    };
    try {
      const row = await runFetch("continueWatching", ctx, { cursor: null, limit: 20 });
      expect(row.outcome).toBe("all_failed");
      expect(row.items).toHaveLength(0);
    } finally {
      ROW_FETCHERS.continueWatching.fetch = original;
    }
  });

  it("classifies a timeout as timeout (and clears the timer in finally)", async () => {
    const original = ROW_FETCHERS.trendingNow.fetch;
    const ctx = makeStubCtx();
    vi.useFakeTimers();
    ROW_FETCHERS.trendingNow.fetch = () =>
      // Never resolves — runFetch must time out before the test would.
      new Promise(() => {});
    try {
      const promise = runFetch("trendingNow", ctx, { cursor: null, limit: 20 });
      await vi.advanceTimersByTimeAsync(5_001);
      const row = await promise;
      expect(row.outcome).toBe("timeout");
    } finally {
      ROW_FETCHERS.trendingNow.fetch = original;
      vi.useRealTimers();
    }
  });

  it("keeps a row alive when the fetcher finishes within the bumped 5s budget (#135)", async () => {
    // Regression for #135: under the old 3s budget a fetcher that needed
    // ~3.4s (one upstream call + a single rate-limit retry) timed out and
    // its row was silently dropped from the layout. The bumped 5s budget
    // gives `invokeOne`'s retry path the headroom it needs.
    const original = ROW_FETCHERS.newReleases.fetch;
    const ctx = makeStubCtx();
    vi.useFakeTimers();
    ROW_FETCHERS.newReleases.fetch = async () => {
      await new Promise((resolve) => setTimeout(resolve, 4_000));
      return {
        items: [{ id: "movie:42", tmdbId: "42", mediaType: "movie", title: "ok" }],
        cursor: null,
      };
    };
    try {
      const promise = runFetch("newReleases", ctx, { cursor: null, limit: 20 });
      await vi.advanceTimersByTimeAsync(4_001);
      const row = await promise;
      expect(row.outcome).toBe("ok_items");
      expect(row.items).toHaveLength(1);
    } finally {
      ROW_FETCHERS.newReleases.fetch = original;
      vi.useRealTimers();
    }
  });

  it("threads a deadline into the fetch ctx so MediaService can short-circuit retries (#135)", async () => {
    const original = ROW_FETCHERS.trendingNow.fetch;
    const ctx = makeStubCtx();
    let received: number | undefined;
    ROW_FETCHERS.trendingNow.fetch = async (innerCtx) => {
      received = innerCtx.deadlineMs;
      return { items: [], cursor: null };
    };
    try {
      const before = Date.now();
      await runFetch("trendingNow", ctx, { cursor: null, limit: 20 });
      // `runFetch` injects `Date.now() + PER_ROW_TIMEOUT_MS`. Allow a small
      // jitter window for clock drift between the assertion bookends.
      expect(received).toBeGreaterThanOrEqual(before + 4_900);
      expect(received).toBeLessThanOrEqual(before + 5_100);
    } finally {
      ROW_FETCHERS.trendingNow.fetch = original;
    }
  });
});

const baseSignals: LayoutSignals = {
  hasWatchHistoryPlugin: false,
  hasWatchlistPlugin: false,
  hasCalendarPlugin: false,
  hasRecommendationsPlugin: false,
  inProgressCount: 0,
  watchlistCount: 0,
  calendarProgressCount: 0,
  profileConfidence: "none",
  recentSeed: null,
};

describe("buildRowStubs", () => {
  it("builds a stub for every rowId in order with null initialCursor by default", () => {
    const stubs = buildRowStubs(["trendingNow", "newReleases"], baseSignals);
    expect(stubs.map((s) => s.rowId)).toEqual(["trendingNow", "newReleases"]);
    expect(stubs.every((s) => s.initialCursor === null)).toBe(true);
  });

  it("sets a seed-pinned initialCursor and subtitle for becauseYouWatched", () => {
    const signals: LayoutSignals = {
      ...baseSignals,
      recentSeed: {
        id: "movie:550",
        tmdbId: "550",
        mediaType: "movie",
        title: "Fight Club",
        reason: "liked",
      },
    };
    const stubs = buildRowStubs(["becauseYouWatched"], signals);
    expect(stubs[0]?.initialCursor).not.toBeNull();
    expect(stubs[0]?.subtitle).toBe("Because you watched Fight Club");
  });

  it("sets null initialCursor for becauseYouWatched when recentSeed is absent", () => {
    const stubs = buildRowStubs(["becauseYouWatched"], baseSignals);
    expect(stubs[0]?.initialCursor).toBeNull();
  });
});

describe("fetchHero", () => {
  it("returns null hero when candidates list is empty", async () => {
    const ctx = makeStubCtx();
    const result = await fetchHero([], ctx);
    expect(result.hero).toBeNull();
    expect(result.heroSource).toBeNull();
    expect(result.heroCursor).toBeNull();
  });

  it("picks the first candidate that returns a non-empty item", async () => {
    const original = ROW_FETCHERS.trendingNow.fetch;
    ROW_FETCHERS.trendingNow.fetch = async () => ({
      items: [{ id: "movie:1", tmdbId: "1", mediaType: "movie", title: "x" }],
      cursor: "c1",
    });
    try {
      const ctx = makeStubCtx();
      const result = await fetchHero(["trendingNow"], ctx);
      expect(result.hero?.source).toBe("trendingNow");
      expect(result.hero?.reason).toBe("trending");
      expect(result.heroCursor).toBe("c1");
    } finally {
      ROW_FETCHERS.trendingNow.fetch = original;
    }
  });

  it("falls back to the next candidate when the first returns empty", async () => {
    const origCW = ROW_FETCHERS.continueWatching.fetch;
    const origTrending = ROW_FETCHERS.trendingNow.fetch;
    ROW_FETCHERS.continueWatching.fetch = async () => ({ items: [], cursor: null });
    ROW_FETCHERS.trendingNow.fetch = async () => ({
      items: [{ id: "movie:3", tmdbId: "3", mediaType: "movie", title: "y" }],
      cursor: null,
    });
    try {
      const ctx = makeStubCtx();
      const result = await fetchHero(["continueWatching", "trendingNow"], ctx);
      expect(result.heroSource).toBe("trendingNow");
    } finally {
      ROW_FETCHERS.continueWatching.fetch = origCW;
      ROW_FETCHERS.trendingNow.fetch = origTrending;
    }
  });

  it("returns null when all candidates are empty", async () => {
    const orig = ROW_FETCHERS.trendingNow.fetch;
    ROW_FETCHERS.trendingNow.fetch = async () => ({ items: [], cursor: null });
    try {
      const ctx = makeStubCtx();
      const result = await fetchHero(["trendingNow"], ctx);
      expect(result.hero).toBeNull();
      expect(result.heroCursor).toBeNull();
    } finally {
      ROW_FETCHERS.trendingNow.fetch = orig;
    }
  });

  it("respects the global hero deadline so per-row timeouts do not compound", async () => {
    // Three hero candidates each hitting the 5s per-row timeout would compound
    // to ~15s without a pipeline-level cap. The 7s global deadline returns a
    // null hero before the third candidate can finish timing out.
    const origCW = ROW_FETCHERS.continueWatching.fetch;
    const origRFY = ROW_FETCHERS.recommendedForYou.fetch;
    const origTrending = ROW_FETCHERS.trendingNow.fetch;
    const hang = () => new Promise<never>(() => {});
    ROW_FETCHERS.continueWatching.fetch = hang;
    ROW_FETCHERS.recommendedForYou.fetch = hang;
    ROW_FETCHERS.trendingNow.fetch = hang;
    vi.useFakeTimers();
    try {
      const ctx = makeStubCtx();
      const promise = fetchHero(["continueWatching", "recommendedForYou", "trendingNow"], ctx);
      await vi.advanceTimersByTimeAsync(7_001);
      const result = await promise;
      expect(result.hero).toBeNull();
      expect(result.heroSource).toBeNull();
      expect(result.heroCursor).toBeNull();
    } finally {
      ROW_FETCHERS.continueWatching.fetch = origCW;
      ROW_FETCHERS.recommendedForYou.fetch = origRFY;
      ROW_FETCHERS.trendingNow.fetch = origTrending;
      vi.useRealTimers();
    }
  });
});

function makeStubCtx(): RowFetchContext {
  return {
    userId: "u1",
    mediaService: {} as RowFetchContext["mediaService"],
    preferenceEngine: {} as RowFetchContext["preferenceEngine"],
    dataloader: {} as RowFetchContext["dataloader"],
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  };
}
