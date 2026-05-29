import { consola } from "consola";
import { describe, expect, it, vi } from "vite-plus/test";
import type { SourceContext } from "../../../media";
import fixture from "../../__tests__/fixtures/home-layout-parity.json";
import { RECOMMENDATIONS } from "../../__tests__/fixtures/home-layout-scenario";
import { recommendedForYouSource } from "../recommended-for-you";

/** Build a `SourceContext` whose catalog + statusBatch resolve the rec list. */
function makeCtx(opts: {
  getRecommendations: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
}): SourceContext {
  return {
    userId: "u1",
    mediaService: {} as SourceContext["mediaService"],
    catalog: { getRecommendations: opts.getRecommendations } as unknown as SourceContext["catalog"],
    statusBatch: { get: opts.get } as unknown as SourceContext["statusBatch"],
    logger: consola.withTag("rec-source-test"),
  };
}

const idsOf = (rows: Array<{ tmdbId: string; type: string }>): string[] =>
  rows.map((r) => `${r.type}:${r.tmdbId}`);
const fixtureIds = (rowId: string): string[] | undefined =>
  fixture.rows.find((r) => r.rowId === rowId)?.ids;

// RISK-103 / design §T: the source must reproduce the US-019 captured ids/order.
describe("home recommended-for-you source", () => {
  it("carries no sort/filter/cursor logic — identity sort, offset mode (V.MC1)", () => {
    expect(recommendedForYouSource.stages).toEqual({ sort: "none", cursorMode: "offset" });
    expect(recommendedForYouSource.stages.classify).toBeUndefined();
    expect(recommendedForYouSource.stages.filter).toBeUndefined();
  });

  it("partitions the rec list by the requested media type (US-019 parity)", async () => {
    const get = vi.fn().mockResolvedValue({});
    const ctx = makeCtx({ getRecommendations: vi.fn().mockResolvedValue(RECOMMENDATIONS), get });
    const movies = await recommendedForYouSource.fetchRawSet(ctx, "movie", null);
    const tv = await recommendedForYouSource.fetchRawSet(ctx, "tv", null);
    expect(idsOf(movies.rows)).toEqual(fixtureIds("recommendedForYou-movies"));
    expect(idsOf(tv.rows)).toEqual(fixtureIds("recommendedForYou-tv"));
    // The catalog is the source of truth, so the source never partials.
    expect(movies.partial).toBe(false);
    expect(movies.nextRaw).toBeUndefined();
  });

  it("drops titles the user can already play (status 'available')", async () => {
    const ctx = makeCtx({
      getRecommendations: vi.fn().mockResolvedValue(RECOMMENDATIONS),
      get: vi.fn().mockResolvedValue({ "movie:rm1": "available", "movie:rm2": "unknown" }),
    });
    const { rows } = await recommendedForYouSource.fetchRawSet(ctx, "movie", null);
    expect(idsOf(rows)).toEqual(["movie:rm2"]);
  });

  it("carries topContributors through on each raw key", async () => {
    const contributors = [{ category: "genre", value: "Sci-Fi", weight: 0.5 }];
    const ctx = makeCtx({
      getRecommendations: vi.fn().mockResolvedValue({
        items: [
          {
            tmdbId: "1",
            mediaType: "tv",
            matchReason: null,
            topContributors: contributors,
            score: 1,
          },
        ],
        profileVersion: 1,
        generatedAt: 0,
      }),
      get: vi.fn().mockResolvedValue({}),
    });
    const { rows } = await recommendedForYouSource.fetchRawSet(ctx, "tv", null);
    expect(rows[0]?.topContributors).toEqual(contributors);
  });

  it("yields zero rows when the user has no rec list", async () => {
    const ctx = makeCtx({
      getRecommendations: vi.fn().mockResolvedValue(null),
      get: vi.fn(),
    });
    const { rows, partial } = await recommendedForYouSource.fetchRawSet(ctx, "movie", null);
    expect(rows).toEqual([]);
    expect(partial).toBe(false);
  });
});
