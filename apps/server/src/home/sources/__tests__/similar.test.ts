import { consola } from "consola";
import { describe, expect, it, vi } from "vite-plus/test";
import type { SourceContext } from "../../../media";
import fixture from "../../__tests__/fixtures/home-layout-parity.json";
import {
  SEED_MEDIA_TYPE,
  SEED_TMDB_ID,
  SIMILAR_FEED,
} from "../../__tests__/fixtures/home-layout-scenario";
import { similarSource } from "../similar";

// The similar source imports `extractTmdbId` from the media barrel (US-024
// folded the home copy onto media's canonical one), which pulls
// `media → db → env`, so the env must be stubbed.
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

/** Build a minimal `SourceContext` whose mediaService resolves the similar feed. */
function makeCtx(getSimilarFeed: ReturnType<typeof vi.fn>): SourceContext {
  return {
    userId: "u1",
    mediaService: { getSimilarFeed } as unknown as SourceContext["mediaService"],
    catalog: {} as SourceContext["catalog"],
    statusBatch: {} as SourceContext["statusBatch"],
    logger: consola.withTag("similar-source-test"),
  };
}

const idsOf = (rows: Array<{ tmdbId: string; type: string }>): string[] =>
  rows.map((r) => `${r.type}:${r.tmdbId}`);

// RISK-103 / design §T: the source must reproduce the US-019 captured ids/order.
describe("home similar source", () => {
  it("carries no sort/filter/cursor logic — identity sort, offset mode (V.MC1)", () => {
    expect(similarSource.stages).toEqual({ sort: "none", cursorMode: "offset" });
    expect(similarSource.stages.classify).toBeUndefined();
    expect(similarSource.stages.filter).toBeUndefined();
  });

  it("returns the FULL similar feed as raw keys for the seed (becauseYouWatched US-019 parity)", async () => {
    const getSimilarFeed = vi.fn().mockResolvedValue(SIMILAR_FEED);
    const { rows, partial, nextRaw } = await similarSource.fetchRawSet(
      makeCtx(getSimilarFeed),
      { seedId: SEED_TMDB_ID, seedType: SEED_MEDIA_TYPE },
      null,
    );
    expect(idsOf(rows)).toEqual(fixture.rows.find((r) => r.rowId === "becauseYouWatched")?.ids);
    expect(partial).toBe(false);
    expect(nextRaw).toBeUndefined();
    // Seed rides in params, not the source — `getSimilarFeed` is keyed by it.
    expect(getSimilarFeed).toHaveBeenCalledWith({ id: SEED_TMDB_ID, type: SEED_MEDIA_TYPE });
  });

  it("drops candidates the entry-shape probe can't key (no tmdb id)", async () => {
    const getSimilarFeed = vi.fn().mockResolvedValue({
      items: [
        { ids: { tmdb: "k1" }, type: "movie" },
        { junk: true },
        { ids: { tmdb: "k2" }, type: "tv" },
      ],
      partial: false,
    });
    const { rows } = await similarSource.fetchRawSet(
      makeCtx(getSimilarFeed),
      { seedId: "s", seedType: "movie" },
      null,
    );
    expect(idsOf(rows)).toEqual(["movie:k1", "tv:k2"]);
  });

  it("propagates a plugin soft-failure as partial", async () => {
    const getSimilarFeed = vi.fn().mockResolvedValue({ items: [], partial: true });
    const { rows, partial } = await similarSource.fetchRawSet(
      makeCtx(getSimilarFeed),
      { seedId: "s", seedType: "movie" },
      null,
    );
    expect(rows).toEqual([]);
    expect(partial).toBe(true);
  });
});
