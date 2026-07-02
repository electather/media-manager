import { consola } from "consola";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { SourceContext } from "../../../media";
import { __clearSimilarFeedCacheForTests, resolveSimilarCandidates } from "../_shared";

vi.mock("../../../env", () => ({
  env: {
    CACHE_PROVIDER: "memory",
    ENCRYPTION_KEY: "test-key",
    SQLITE_PATH: "file::memory:",
    BETTER_AUTH_SECRET: "x".repeat(32),
    BETTER_AUTH_URL: "http://localhost",
    APP_EXTERNAL_URL: "http://localhost",
  },
}));

function makeCtx(userId: string, getSimilarFeed: ReturnType<typeof vi.fn>): SourceContext {
  return {
    userId,
    mediaService: { getSimilarFeed } as unknown as SourceContext["mediaService"],
    catalog: {
      getMetadata: vi.fn().mockResolvedValue(undefined),
    } as unknown as SourceContext["catalog"],
    statusBatch: {} as SourceContext["statusBatch"],
    logger: consola.withTag("similar-throttle-test"),
  };
}

beforeEach(() => __clearSimilarFeedCacheForTests());

// #923: seedId is client-controlled and cache-bustable. These tests lock in that only
// cache-MISS external fetches are throttled, so abuse (cycling ids) is bounded while
// legitimate pagination (same seed re-read) stays free.
describe("similar seed throttle (#923)", () => {
  it("throttles per-user distinct-seed fetches past the 30-fetch burst", async () => {
    const getSimilarFeed = vi.fn().mockResolvedValue({ items: [], partial: false });
    const ctx = makeCtx("attacker", getSimilarFeed);

    // 30 distinct seeds drain the burst; each is a cache miss → one external fetch.
    for (let i = 0; i < 30; i++) {
      await resolveSimilarCandidates(ctx, `seed-${i}`, "movie");
    }
    expect(getSimilarFeed).toHaveBeenCalledTimes(30);

    await expect(resolveSimilarCandidates(ctx, "seed-31", "movie")).rejects.toMatchObject({
      code: "home.similar_seed_rate_limited",
      status: 429,
    });
    // The rejected 31st seed never reached the external API.
    expect(getSimilarFeed).toHaveBeenCalledTimes(30);
  });

  it("does not debit on cache hits, so pagination over one seed is unlimited", async () => {
    const getSimilarFeed = vi.fn().mockResolvedValue({ items: [], partial: false });
    const ctx = makeCtx("legit", getSimilarFeed);

    // Same seed paged 100 times: one external fetch, no throttle.
    for (let i = 0; i < 100; i++) {
      await resolveSimilarCandidates(ctx, "seed-a", "movie");
    }
    expect(getSimilarFeed).toHaveBeenCalledTimes(1);
  });

  it("keys the budget per user — one user cannot exhaust another's", async () => {
    const getSimilarFeed = vi.fn().mockResolvedValue({ items: [], partial: false });
    for (let i = 0; i < 30; i++) {
      await resolveSimilarCandidates(makeCtx("u1", getSimilarFeed), `seed-${i}`, "movie");
    }
    await expect(
      resolveSimilarCandidates(makeCtx("u1", getSimilarFeed), "seed-x", "movie"),
    ).rejects.toMatchObject({ code: "home.similar_seed_rate_limited" });

    // A different user still has a full budget.
    await expect(
      resolveSimilarCandidates(makeCtx("u2", getSimilarFeed), "seed-y", "movie"),
    ).resolves.toBeDefined();
  });
});
