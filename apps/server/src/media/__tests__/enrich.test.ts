import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { CanonicalMetadata } from "@ent-mcp/shared/catalog";
import type { MediaEnrichContext, MediaEnrichRow } from "../enrich";

vi.mock("../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

vi.mock("../../plugin-runtime", async () => {
  const actual =
    await vi.importActual<typeof import("../../plugin-runtime")>("../../plugin-runtime");
  return {
    ...actual,
    capabilityRegistry: { listProviders: () => [] },
  };
});

const { enrich } = await import("../enrich");
const { __resetAvailabilityCache } = await import("../testing");

function meta(overrides: Partial<CanonicalMetadata>): CanonicalMetadata {
  return {
    tmdbId: "1",
    mediaType: "movie",
    title: "T",
    year: 2024,
    runtimeMinutes: null,
    posterUrl: null,
    backdropUrl: null,
    clearLogoUrl: null,
    overview: null,
    originalLanguage: null,
    genres: null,
    features: null,
    lastRefreshedAt: 0,
    lastAccessedAt: 0,
    createdAt: 0,
    ...overrides,
  };
}

function ctx(): MediaEnrichContext {
  return {
    userId: "u1",
    // No `toCanonicalRow` → cold-fill short-circuits to null, so a row missing
    // from `prefetchedBatch.metadata` stays unresolved (the dead-id case). No
    // `getArtwork` → artwork hydration short-circuits.
    mediaService: {
      getMatchingServers: vi.fn().mockResolvedValue([]),
      getMetadata: vi.fn().mockResolvedValue(null),
      getStatusBatch: vi.fn().mockResolvedValue({}),
    } as never,
    catalog: {} as never,
    loadProgressMap: vi.fn().mockResolvedValue({ map: new Map(), partial: false }),
    log: { warn: vi.fn() } as never,
  };
}

const LIVE: MediaEnrichRow = { tmdbId: "550", mediaType: "movie", addedAt: 1, source: "manual" };
// Mirrors the real bug: a plugin-seeded row pointing at a tmdb id that 404s on
// TMDB (a stale Trakt extended-edition entry) and so resolves to no metadata.
const DEAD: MediaEnrichRow = { tmdbId: "329367", mediaType: "movie", addedAt: 2, source: "plugin" };

beforeEach(() => {
  __resetAvailabilityCache();
});

describe("enrich — unresolvable rows (#516 follow-up: no 'Movie <id>' placeholders)", () => {
  it("drops a row whose tmdb id resolves to no metadata instead of emitting a placeholder", async () => {
    const c = ctx();
    const out = await enrich([LIVE, DEAD], c, {
      prefetchedBatch: {
        statuses: {},
        // Only the live id has canonical metadata; the dead id is absent and,
        // with cold-fill disabled, stays absent.
        metadata: { "movie:550": meta({ tmdbId: "550", title: "Fight Club" }) },
        progress: new Map(),
      },
    });

    // The dead row is dropped, not rendered as "Movie 329367".
    expect(out.items).toHaveLength(1);
    expect(out.items[0]?.tmdbId).toBe("550");
    expect(out.items[0]?.title).toBe("Fight Club");
    expect(out.items.some((i) => i.tmdbId === "329367")).toBe(false);
    expect(out.items.some((i) => /^Movie \d+$/.test(i.title))).toBe(false);
    // `sources` stays aligned with the surviving items.
    expect(out.sources).toEqual([LIVE]);
  });

  it("logs the dropped id so a dead mapping is diagnosable rather than silent", async () => {
    const c = ctx();
    await enrich([DEAD], c, {
      prefetchedBatch: { statuses: {}, metadata: {}, progress: new Map() },
    });

    expect(c.log.warn).toHaveBeenCalledWith(
      "[media:enrich] dropped row with no resolvable metadata",
      { tmdbId: "329367", mediaType: "movie" },
    );
  });

  it("keeps every row when all metadata resolves (no over-dropping)", async () => {
    const c = ctx();
    const out = await enrich([LIVE, DEAD], c, {
      prefetchedBatch: {
        statuses: {},
        metadata: {
          "movie:550": meta({ tmdbId: "550", title: "Fight Club" }),
          "movie:329367": meta({ tmdbId: "329367", title: "Real Title" }),
        },
        progress: new Map(),
      },
    });

    expect(out.items).toHaveLength(2);
    expect(c.log.warn).not.toHaveBeenCalled();
  });
});
