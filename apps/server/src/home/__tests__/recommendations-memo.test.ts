import { describe, expect, it, vi } from "vite-plus/test";
import type { CatalogService } from "../../catalog";
import { makeRecommendationsMemo } from "../internal/recommendations-memo";

const REC_LIST = { items: [], profileVersion: 1, generatedAt: 0 };

describe("makeRecommendationsMemo", () => {
  // The recommendedForYou-* rows read the rec list from eligibility + source
  // across two partitions, and the hero reads it too — up to four reads per
  // compose. The memo exists to collapse those into one underlying fetch, so a
  // regression that drops the caching would surface as extra catalog calls here.
  it("fetches the default rec list once across many reads", async () => {
    const getRecommendations = vi.fn().mockResolvedValue(REC_LIST);
    const memo = makeRecommendationsMemo({ getRecommendations } as unknown as CatalogService, "u1");

    const results = await Promise.all([memo(), memo(), memo(), memo()]);

    expect(getRecommendations).toHaveBeenCalledTimes(1);
    expect(getRecommendations).toHaveBeenCalledWith("u1", "default");
    // Every reader gets the same resolved list.
    for (const r of results) expect(r).toBe(REC_LIST);
  });

  it("shares one in-flight fetch when reads overlap before resolution", async () => {
    // Concurrent readers must not each kick off their own fetch; the memo caches
    // the promise, not just the resolved value.
    let resolveFetch: (v: typeof REC_LIST) => void = () => {};
    const getRecommendations = vi.fn(
      () =>
        new Promise<typeof REC_LIST>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const memo = makeRecommendationsMemo({ getRecommendations } as unknown as CatalogService, "u1");

    const first = memo();
    const second = memo();
    resolveFetch(REC_LIST);
    await Promise.all([first, second]);

    expect(getRecommendations).toHaveBeenCalledTimes(1);
  });
});
