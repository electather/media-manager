import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { consola } from "consola";
import type { DiscoverFeedKind, MetadataKey } from "@nama/shared/catalog";
import type { RowContext } from "../internal/types";
import fixture from "./fixtures/home-layout-parity.json";
import {
  buildScenarioMetadata,
  buildSeedMetadata,
  CONTINUE_WATCHING_FEED,
  NEW_RELEASES_SNAPSHOT,
  PARITY_USER_ID,
  RECOMMENDATIONS,
  SEED_MEDIA_TYPE,
  SEED_TMDB_ID,
  SIMILAR_FEED,
  TRENDING_SNAPSHOT,
  UPCOMING_FEED,
  USER_HISTORY,
  WATCHLIST_AVAILABLE,
} from "./fixtures/home-layout-scenario";

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

// Media owns enrichment; it is 1:1 + order-preserving over the row items and is
// NOT touched by the US-020..US-022 source migration. A pass-through keeps the
// fixture pinned to the row-fetch behavior (which ids reach the wire, in what
// order) — exactly what the migration changes — without standing up artwork,
// status, and matching-server fan-out.
vi.mock("../../media", async () => {
  const actual = await vi.importActual<typeof import("../../media")>("../../media");
  return {
    ...actual,
    enrichCompactItems: vi.fn(async (items: unknown[]) => ({ items, partial: false })),
  };
});

// `yourWatchlist` reads through the watchlist module boundary; mock it so the
// row has deterministic available items without a seeded watchlist DB.
vi.mock("../../watchlist", () => ({
  hasAny: vi.fn().mockResolvedValue(true),
  listAvailable: vi.fn().mockResolvedValue(WATCHLIST_AVAILABLE),
}));

const { composeLayoutLive } = await import("../internal/layout");
const { composeRowPage } = await import("../internal/row");
const { __clearSimilarFeedCacheForTests } = await import("../rows/_shared");

const SCENARIO_METADATA = buildScenarioMetadata();
const SEED_METADATA = buildSeedMetadata();

/**
 * Builds a row context whose `mediaService` / `catalog` mocks resolve the
 * deterministic scenario feeds. All capability probes pass so every row in
 * `ROW_ORDER` is eligible and ships at least one item.
 */
function makeScenarioCtx(): RowContext {
  const mediaService = {
    hasCapabilityProvider: vi.fn().mockResolvedValue(true),
    getContinueWatchingFeed: vi.fn().mockResolvedValue({
      items: CONTINUE_WATCHING_FEED,
      partial: false,
    }),
    getSimilarFeed: vi.fn().mockResolvedValue(SIMILAR_FEED),
    getUpcomingFeed: vi.fn().mockResolvedValue(UPCOMING_FEED),
  } as unknown as RowContext["mediaService"];

  const catalog = {
    getDiscoverFeed: vi.fn(async (kind: DiscoverFeedKind) => {
      if (kind === "trending") return TRENDING_SNAPSHOT;
      if (kind === "newReleases") return NEW_RELEASES_SNAPSHOT;
      return null;
    }),
    // `hasDiscoverFeed` is the new cheap-eligibility probe (replaces the
    // earlier double-`fetchRawSet` per layout render). Keep it in sync with
    // `getDiscoverFeed` so a fixture snapshot's presence flips eligibility on.
    hasDiscoverFeed: vi.fn(
      async (kind: DiscoverFeedKind) => kind === "trending" || kind === "newReleases",
    ),
    getRecommendations: vi.fn().mockResolvedValue(RECOMMENDATIONS),
    getMetadataBatch: vi.fn(async (keys: MetadataKey[]) => {
      const out: Record<string, unknown> = {};
      for (const k of keys) {
        const id = `${k.type}:${k.tmdbId}`;
        if (SCENARIO_METADATA[id]) out[id] = SCENARIO_METADATA[id];
      }
      return out;
    }),
    getMetadata: vi.fn(async (id: string, type: string) =>
      id === SEED_TMDB_ID && type === SEED_MEDIA_TYPE ? SEED_METADATA : null,
    ),
    getUserHistory: vi.fn().mockResolvedValue(USER_HISTORY),
    getUserRatings: vi.fn().mockResolvedValue([]),
  } as unknown as RowContext["catalog"];

  const statusBatch = {
    get: vi.fn().mockResolvedValue({}),
  } as unknown as RowContext["statusBatch"];

  return {
    userId: PARITY_USER_ID,
    mediaService,
    catalog,
    statusBatch,
    logger: consola.withTag("home-parity"),
  };
}

let ctx: RowContext;

beforeEach(() => {
  __clearSimilarFeedCacheForTests();
  ctx = makeScenarioCtx();
});

// RISK-103 / design §T: these fixtures lock the current home layout output
// (row order + item ids/order per row + hero slides) so the US-020..US-022
// `MediaSource` reimplementations can be proven behavior-neutral. The WHY
// (Rule 9): a subtle sort / slice / cursor / ranking change during the
// migration must fail here, not ship silently.
describe("home layout parity fixtures", () => {
  it("composes the captured row order", async () => {
    const layout = await composeLayoutLive(ctx);
    expect(layout.rows.map((r) => r.rowId)).toEqual(fixture.rows.map((r) => r.rowId));
  });

  it("each row produces the captured item ids in order", async () => {
    const layout = await composeLayoutLive(ctx);
    for (const stub of layout.rows) {
      const expected = fixture.rows.find((r) => r.rowId === stub.rowId);
      const page = await composeRowPage(ctx, stub.rowId, stub.initialCursor);
      expect(
        page.items.map((i) => i.id),
        `row ${stub.rowId} items`,
      ).toEqual(expected?.ids);
    }
  });

  it("composes the captured hero slides in order", async () => {
    const layout = await composeLayoutLive(ctx);
    const slides = layout.hero?.slides ?? [];
    expect(slides.map((s) => s.item.id)).toEqual(fixture.hero.ids);
    expect(slides.map((s) => s.source)).toEqual(fixture.hero.sources);
  });
});
