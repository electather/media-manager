import { consola } from "consola";
import { describe, expect, it, vi } from "vite-plus/test";
import type { SourceContext } from "../../../media";
import fixture from "../../__tests__/fixtures/home-layout-parity.json";
import { UPCOMING_FEED } from "../../__tests__/fixtures/home-layout-scenario";
import { upcomingForYouSource } from "../upcoming";

// `upcomingForYouSource` pulls `probeMediaEntry` from `rows/_shared`, which now
// imports `extractTmdbId` from the media barrel (US-024 consolidation) and so
// drags `media → db → env`; the env must be stubbed.
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

/** Build a `SourceContext` whose mediaService resolves the calendar feed. */
function makeCtx(getUpcomingFeed: ReturnType<typeof vi.fn>): SourceContext {
  return {
    userId: "u1",
    mediaService: { getUpcomingFeed } as unknown as SourceContext["mediaService"],
    catalog: {} as SourceContext["catalog"],
    statusBatch: {} as SourceContext["statusBatch"],
    logger: consola.withTag("upcoming-source-test"),
  };
}

const idsOf = (rows: Array<{ tmdbId: string; type: string }>): string[] =>
  rows.map((r) => `${r.type}:${r.tmdbId}`);

// RISK-103 / design §T: the source must reproduce the US-019 captured ids/order.
describe("home upcoming source", () => {
  it("carries no sort/filter/cursor logic — identity sort, offset mode (V.MC1)", () => {
    expect(upcomingForYouSource.stages).toEqual({ sort: "none", cursorMode: "offset" });
    expect(upcomingForYouSource.stages.classify).toBeUndefined();
    expect(upcomingForYouSource.stages.filter).toBeUndefined();
  });

  it("returns the feed hits as raw keys with the episode payload (US-019 parity)", async () => {
    const { rows, partial, nextRaw } = await upcomingForYouSource.fetchRawSet(
      makeCtx(vi.fn().mockResolvedValue(UPCOMING_FEED)),
      undefined,
      null,
    );
    expect(idsOf(rows)).toEqual(fixture.rows.find((r) => r.rowId === "upcomingForYou")?.ids);
    expect(rows[0]?.episode).toEqual({
      season: 1,
      episode: 2,
      airsAt: Date.parse("2026-06-01T20:00:00Z"),
      name: "Upcoming One",
    });
    expect(partial).toBe(false);
    expect(nextRaw).toBeUndefined();
  });

  it("collapses repeated tmdbIds to one card per show (earliest queued episode)", async () => {
    // Calendar plugins emit one entry per upcoming episode in air order, so a
    // show with N queued episodes appears N times; the source dedupes to the
    // first (earliest-airing) occurrence so React keys stay unique downstream.
    const feed = {
      items: [
        {
          airDate: "2026-06-01T20:00:00Z",
          airsAt: "2026-06-01T20:00:00Z",
          item: { ids: { tmdb: "100" }, type: "show", title: "S1E1", season: 1, episode: 1 },
        },
        {
          airDate: "2026-06-08T20:00:00Z",
          airsAt: "2026-06-08T20:00:00Z",
          item: { ids: { tmdb: "100" }, type: "show", title: "S1E2", season: 1, episode: 2 },
        },
        {
          airDate: "2026-06-02T20:00:00Z",
          airsAt: "2026-06-02T20:00:00Z",
          item: { ids: { tmdb: "200" }, type: "show", title: "Other", season: 1, episode: 1 },
        },
      ],
      partial: false,
    };
    const { rows } = await upcomingForYouSource.fetchRawSet(
      makeCtx(vi.fn().mockResolvedValue(feed)),
      undefined,
      null,
    );
    expect(rows.map((r) => r.tmdbId)).toEqual(["100", "200"]);
    expect(rows[0]?.episode?.episode).toBe(1);
  });

  it("propagates a calendar-plugin soft-failure as partial", async () => {
    const { rows, partial } = await upcomingForYouSource.fetchRawSet(
      makeCtx(vi.fn().mockResolvedValue({ items: [], partial: true })),
      undefined,
      null,
    );
    expect(rows).toEqual([]);
    expect(partial).toBe(true);
  });
});
