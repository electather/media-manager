import { describe, expect, it, vi } from "vite-plus/test";
import type { ContinueWatchingEntry } from "@ent-mcp/plugin-sdk";

vi.mock("../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));
vi.mock("../../media", async () => {
  const actual = await vi.importActual<typeof import("../../media")>("../../media");
  return {
    ...actual,
    enrichCompactItems: vi.fn(async (items: unknown[]) => ({ items, partial: false })),
  };
});

const { pickHero } = await import("../internal/hero");
const { makeRowCtx } = await import("./row-test-helpers");

/**
 * Fixture shape per plan §Phase 2 Task-019.
 *
 * - CW pool: `cwEntry` produces a `ContinueWatchingEntry` with `lastPlayedAt`
 *   set so `orderBy(lastPlayedAt desc)` is stable (test-control of priority).
 * - Recommendations pool: items pre-sorted by index (rec list order is
 *   preserved by `loadRecommendedPool`); metadata batch echoes per-key meta.
 * - Discover pools (trending / newReleases): the `getDiscoverFeed` mock
 *   returns a snapshot keyed by `{tmdbId, type}`; metadata batch echoes per
 *   key.
 *
 * Quota: 1 CW + 2 rec + 2 trend + 1 new = 6.
 * Priority cascade for backfill + ordering: [CW, rec, trend, new].
 */

function cwEntry(opts: {
  tmdbId: string;
  title?: string;
  progressMs?: number;
  durationSec?: number;
  lastPlayedAt?: string;
}): ContinueWatchingEntry {
  return {
    item: {
      id: `srv:${opts.tmdbId}`,
      title: opts.title ?? `CW ${opts.tmdbId}`,
      type: "movie",
      quality: {},
      playerLink: "x://",
      addedAt: "2026-01-01T00:00:00Z",
      durationSec: opts.durationSec ?? 6000,
      ids: { tmdb: opts.tmdbId },
    },
    progressMs: opts.progressMs ?? 30_000,
    lastPlayedAt: opts.lastPlayedAt ?? "2026-05-01T00:00:00Z",
  } as unknown as ContinueWatchingEntry;
}

function metaRow(tmdbId: string, mediaType: "movie" | "tv" = "movie", title?: string) {
  return {
    tmdbId,
    mediaType,
    title: title ?? `Title ${tmdbId}`,
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
  };
}

function metaBatch(ids: { tmdbId: string; mediaType?: "movie" | "tv" }[]) {
  const out: Record<string, ReturnType<typeof metaRow>> = {};
  for (const { tmdbId, mediaType = "movie" } of ids) {
    out[`${mediaType}:${tmdbId}`] = metaRow(tmdbId, mediaType);
  }
  return out;
}

function fullCtx(opts: {
  cwIds?: string[];
  recIds?: string[];
  trendingIds?: string[];
  newIds?: string[];
}) {
  const cwIds = opts.cwIds ?? [];
  const recIds = opts.recIds ?? [];
  const trendingIds = opts.trendingIds ?? [];
  const newIds = opts.newIds ?? [];

  return makeRowCtx({
    mediaService: {
      hasCapabilityProvider: vi.fn().mockResolvedValue(true),
      getContinueWatchingFeed: vi.fn().mockResolvedValue({
        items: cwIds.map((id, i) =>
          cwEntry({
            tmdbId: id,
            // Descending lastPlayedAt preserves array order through orderBy.
            lastPlayedAt: `2026-05-${(30 - i).toString().padStart(2, "0")}T00:00:00Z`,
          }),
        ),
        partial: false,
      }),
    } as never,
    catalog: {
      getRecommendations: vi.fn().mockResolvedValue(
        recIds.length === 0
          ? null
          : {
              items: recIds.map((id) => ({
                tmdbId: id,
                mediaType: "movie",
                matchReason: null,
                topContributors: [],
                score: 1,
              })),
              profileVersion: 1,
              generatedAt: 0,
            },
      ),
      getMetadataBatch: vi
        .fn()
        .mockResolvedValue(
          metaBatch([
            ...recIds.map((id) => ({ tmdbId: id, mediaType: "movie" as const })),
            ...trendingIds.map((id) => ({ tmdbId: id, mediaType: "movie" as const })),
            ...newIds.map((id) => ({ tmdbId: id, mediaType: "movie" as const })),
          ]),
        ),
      getDiscoverFeed: vi.fn().mockImplementation(async (kind: string) => {
        if (kind === "trending")
          return trendingIds.length === 0
            ? null
            : trendingIds.map((id) => ({ tmdbId: id, type: "movie" as const }));
        if (kind === "newReleases")
          return newIds.length === 0
            ? null
            : newIds.map((id) => ({ tmdbId: id, type: "movie" as const }));
        return null;
      }),
    } as never,
  });
}

describe("pickHero mixer", () => {
  it("ships full quota mix (1+2+2+1 = 6) when all sources populated", async () => {
    const ctx = fullCtx({
      cwIds: ["c1", "c2"],
      recIds: ["r1", "r2", "r3"],
      trendingIds: ["t1", "t2", "t3"],
      newIds: ["n1", "n2"],
    });
    const hero = await pickHero(ctx);
    expect(hero).not.toBeNull();
    const slides = hero!.slides;
    expect(slides).toHaveLength(6);
    const counts = slides.reduce<Record<string, number>>((acc, s) => {
      acc[s.source] = (acc[s.source] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({
      continueWatching: 1,
      recommendedForYou: 2,
      trendingNow: 2,
      newReleases: 1,
    });
  });

  it("backfills empty CW slot from highest-priority remaining pool (recs)", async () => {
    const ctx = fullCtx({
      cwIds: [],
      recIds: ["r1", "r2", "r3"],
      trendingIds: ["t1", "t2"],
      newIds: ["n1"],
    });
    const hero = await pickHero(ctx);
    expect(hero).not.toBeNull();
    const slides = hero!.slides;
    expect(slides).toHaveLength(6);
    const recCount = slides.filter((s) => s.source === "recommendedForYou").length;
    // Quota 2 + backfilled 1 (next priority after empty CW) = 3.
    expect(recCount).toBe(3);
    expect(slides.some((s) => s.source === "continueWatching")).toBe(false);
  });

  it("only CW populated — degenerate fill, all same-source slides", async () => {
    const ctx = fullCtx({
      cwIds: ["c1", "c2", "c3", "c4"],
    });
    const hero = await pickHero(ctx);
    expect(hero).not.toBeNull();
    const slides = hero!.slides;
    expect(slides.length).toBeGreaterThanOrEqual(1);
    expect(slides.length).toBeLessThanOrEqual(4);
    expect(slides.every((s) => s.source === "continueWatching")).toBe(true);
    expect(slides.every((s) => s.reason === "continue_watching")).toBe(true);
  });

  it("only newReleases populated — lead from newReleases", async () => {
    const ctx = fullCtx({
      newIds: ["n1", "n2", "n3"],
    });
    const hero = await pickHero(ctx);
    expect(hero).not.toBeNull();
    const slides = hero!.slides;
    expect(slides.every((s) => s.source === "newReleases")).toBe(true);
    expect(slides[0]!.source).toBe("newReleases");
  });

  it("returns null when every source is empty", async () => {
    const ctx = makeRowCtx({
      mediaService: {
        hasCapabilityProvider: vi.fn().mockResolvedValue(false),
        getContinueWatchingFeed: vi.fn().mockResolvedValue({ items: [], partial: false }),
      } as never,
      catalog: {
        getRecommendations: vi.fn().mockResolvedValue(null),
        getMetadataBatch: vi.fn().mockResolvedValue({}),
        getDiscoverFeed: vi.fn().mockResolvedValue(null),
      } as never,
    });
    expect(await pickHero(ctx)).toBeNull();
  });

  it("each slide.source / slide.reason matches origin pool", async () => {
    const ctx = fullCtx({
      cwIds: ["c1"],
      recIds: ["r1", "r2"],
      trendingIds: ["t1", "t2"],
      newIds: ["n1"],
    });
    const hero = await pickHero(ctx);
    const slides = hero!.slides;
    for (const s of slides) {
      const id = s.item.tmdbId;
      if (id.startsWith("c")) {
        expect(s.source).toBe("continueWatching");
        expect(s.reason).toBe("continue_watching");
      } else if (id.startsWith("r")) {
        expect(s.source).toBe("recommendedForYou");
        expect(s.reason).toBe("recommended");
      } else if (id.startsWith("t")) {
        expect(s.source).toBe("trendingNow");
        expect(s.reason).toBe("trending");
      } else if (id.startsWith("n")) {
        expect(s.source).toBe("newReleases");
        expect(s.reason).toBe("new_release");
      }
    }
  });

  it("lead = highest-priority non-empty source (CW present)", async () => {
    const ctx = fullCtx({
      cwIds: ["c1"],
      recIds: ["r1", "r2"],
      trendingIds: ["t1", "t2"],
      newIds: ["n1"],
    });
    const hero = await pickHero(ctx);
    expect(hero!.slides[0]!.source).toBe("continueWatching");
  });

  it("lead = recommendedForYou when CW empty", async () => {
    const ctx = fullCtx({
      recIds: ["r1", "r2"],
      trendingIds: ["t1", "t2"],
      newIds: ["n1"],
    });
    const hero = await pickHero(ctx);
    expect(hero!.slides[0]!.source).toBe("recommendedForYou");
  });

  it("new-user (empty CW) order matches design doc — [rec, trend, new, rec, trend, rec]", async () => {
    const ctx = fullCtx({
      cwIds: [],
      recIds: ["r1", "r2", "r3"],
      trendingIds: ["t1", "t2"],
      newIds: ["n1"],
    });
    const hero = await pickHero(ctx);
    const sources = hero!.slides.map((s) => s.source);
    expect(sources).toEqual([
      "recommendedForYou",
      "trendingNow",
      "newReleases",
      "recommendedForYou",
      "trendingNow",
      "recommendedForYou",
    ]);
  });

  it("body order is round-robin interleave by priority over remainder", async () => {
    const ctx = fullCtx({
      cwIds: ["c1"],
      recIds: ["r1", "r2"],
      trendingIds: ["t1", "t2"],
      newIds: ["n1"],
    });
    const hero = await pickHero(ctx);
    const sources = hero!.slides.map((s) => s.source);
    // Lead is CW; remainder interleaves rec, trend, new, rec, trend per priority.
    expect(sources).toEqual([
      "continueWatching",
      "recommendedForYou",
      "trendingNow",
      "newReleases",
      "recommendedForYou",
      "trendingNow",
    ]);
  });

  it("backfill never duplicates ${source}:${tmdbId} across slides", async () => {
    const ctx = fullCtx({
      cwIds: [],
      recIds: ["r1", "r2", "r3", "r4", "r5", "r6"],
    });
    const hero = await pickHero(ctx);
    const keys = hero!.slides.map((s) => `${s.source}:${s.item.tmdbId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("dedupes same tmdbId across trendingNow + newReleases — trending wins, hero fills to 6", async () => {
    const ctx = fullCtx({
      cwIds: [],
      recIds: ["r1", "r2", "r3", "r4"],
      trendingIds: ["dup", "t2"],
      newIds: ["dup"],
    });
    const hero = await pickHero(ctx);
    expect(hero).not.toBeNull();
    const slides = hero!.slides;
    expect(slides).toHaveLength(6);
    const dupSlides = slides.filter((s) => s.item.tmdbId === "dup");
    expect(dupSlides).toHaveLength(1);
    expect(dupSlides[0]!.source).toBe("trendingNow");
    expect(slides.some((s) => s.source === "newReleases" && s.item.tmdbId === "dup")).toBe(false);
  });

  it("dedupes same tmdbId across all four sources — highest priority (CW) wins", async () => {
    const ctx = fullCtx({
      cwIds: ["dup"],
      recIds: ["dup", "r2", "r3"],
      trendingIds: ["dup", "t2"],
      newIds: ["dup"],
    });
    const hero = await pickHero(ctx);
    expect(hero).not.toBeNull();
    const slides = hero!.slides;
    const dupSlides = slides.filter((s) => s.item.tmdbId === "dup");
    expect(dupSlides).toHaveLength(1);
    expect(dupSlides[0]!.source).toBe("continueWatching");
  });

  it("every slide.resumeUrl === null v1 (R2 — playback@v1.getResumeUrl absent)", async () => {
    const ctx = fullCtx({
      cwIds: ["c1"],
      recIds: ["r1", "r2"],
      trendingIds: ["t1", "t2"],
      newIds: ["n1"],
    });
    const hero = await pickHero(ctx);
    expect(hero!.slides.every((s) => s.resumeUrl === null)).toBe(true);
  });

  // Regression for plan TEST-004 (per-pool hero soft-failure). A single slow
  // / failing source must collapse to `[]` without nulling the entire hero —
  // mixer + backfill still draw from the remaining pools. Guards against a
  // refactor back to a blanket `.catch(() => null)` on `resolveHero`.
  it("collapses one rejected pool to [] and still ships hero from the rest", async () => {
    const ctx = fullCtx({
      cwIds: ["c1"],
      recIds: ["r1", "r2", "r3"],
      trendingIds: ["t1", "t2"],
      newIds: ["n1"],
    });
    // Make the trending discover read reject — only that pool should collapse.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    vi.mocked(ctx.catalog.getDiscoverFeed).mockImplementation(async (kind: string) => {
      if (kind === "trending") throw new Error("trending pool boom");
      if (kind === "newReleases") return [{ tmdbId: "n1", type: "movie" as const }];
      return null;
    });

    const hero = await pickHero(ctx);

    expect(hero).not.toBeNull();
    const sources = hero!.slides.map((s) => s.source);
    expect(sources).not.toContain("trendingNow");
    expect(sources).toContain("continueWatching");
    expect(sources).toContain("recommendedForYou");
    expect(sources).toContain("newReleases");
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      "[home:hero] pool trendingNow threw",
      expect.any(Error),
    );
  });
});
