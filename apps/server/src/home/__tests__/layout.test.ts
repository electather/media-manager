import { describe, it, expect, vi } from "vite-plus/test";
import { runFetch } from "../layout";
import { ROW_FETCHERS } from "../rows/index";
import { AllPluginsFailedError } from "../../media/errors";
import type { RowFetchContext } from "../rows/index";

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
      await vi.advanceTimersByTimeAsync(3_001);
      const row = await promise;
      expect(row.outcome).toBe("timeout");
    } finally {
      ROW_FETCHERS.trendingNow.fetch = original;
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
