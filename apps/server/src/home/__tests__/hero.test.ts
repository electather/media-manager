import { describe, expect, it, vi } from "vite-plus/test";
import type { ContinueWatchingEntry } from "@ent-mcp/plugin-sdk";

vi.mock("../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));
vi.mock("../enrich", () => ({
  enrichItems: vi.fn(async (items: unknown[]) => items),
}));

const { pickHero } = await import("../hero");
const { makeRowCtx } = await import("./row-test-helpers");

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
      title: opts.title ?? `Title ${opts.tmdbId}`,
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

describe("pickHero cascade", () => {
  it("returns continueWatching when eligible", async () => {
    const ctx = makeRowCtx({
      mediaService: {
        hasCapabilityProvider: vi.fn().mockResolvedValue(true),
        getContinueWatchingFeed: vi.fn().mockResolvedValue({
          items: [
            cwEntry({ tmdbId: "1", lastPlayedAt: "2026-05-02T00:00:00Z" }),
            cwEntry({ tmdbId: "2", lastPlayedAt: "2026-05-01T00:00:00Z" }),
          ],
          partial: false,
        }),
      } as never,
    });
    const hero = await pickHero(ctx);
    expect(hero).not.toBeNull();
    expect(hero!.source).toBe("continueWatching");
    expect(hero!.reason).toBe("continue_watching");
    expect(hero!.item.tmdbId).toBe("1");
    expect(hero!.alternates.map((a) => a.tmdbId)).toEqual(["2"]);
    expect(hero!.resumeUrl).toBeNull();
  });

  it("falls through to recommended when continueWatching is empty", async () => {
    const ctx = makeRowCtx({
      mediaService: {
        hasCapabilityProvider: vi.fn().mockResolvedValue(true),
        getContinueWatchingFeed: vi.fn().mockResolvedValue({ items: [], partial: false }),
      } as never,
      catalog: {
        getRecommendations: vi.fn().mockResolvedValue({
          items: [
            { tmdbId: "10", mediaType: "movie", matchReason: null, topContributors: [], score: 1 },
          ],
          profileVersion: 1,
          generatedAt: 0,
        }),
        getMetadataBatch: vi.fn().mockResolvedValue({
          "movie:10": {
            tmdbId: "10",
            mediaType: "movie",
            title: "Rec",
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
          },
        }),
        getDiscoverFeed: vi.fn().mockResolvedValue(null),
      } as never,
    });
    const hero = await pickHero(ctx);
    expect(hero).not.toBeNull();
    expect(hero!.source).toBe("recommendedForYou");
    expect(hero!.item.tmdbId).toBe("10");
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

  it("alternates exclude head and never include __internal fields", async () => {
    const entries = ["1", "2", "3", "4", "5", "6"].map((id, idx) =>
      cwEntry({
        tmdbId: id,
        lastPlayedAt: `2026-05-${(idx + 1).toString().padStart(2, "0")}T00:00:00Z`,
      }),
    );
    const ctx = makeRowCtx({
      mediaService: {
        hasCapabilityProvider: vi.fn().mockResolvedValue(true),
        getContinueWatchingFeed: vi.fn().mockResolvedValue({ items: entries, partial: false }),
      } as never,
    });
    const hero = await pickHero(ctx);
    expect(hero).not.toBeNull();
    // Pool of 5 → head + 4 alternates.
    expect(hero!.alternates).toHaveLength(4);
    expect(hero!.alternates.find((a) => a.tmdbId === hero!.item.tmdbId)).toBeUndefined();
    for (const item of [hero!.item, ...hero!.alternates]) {
      expect(item).not.toHaveProperty("__topContributors");
      expect(item).not.toHaveProperty("__addedAtMs");
    }
  });
});
