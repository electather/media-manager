import { beforeEach, describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import provider from "../because-you-watched";
import { __clearSimilarFeedCacheForTests } from "../_shared";
import { libraryItem, makeRowCtx } from "../../__tests__/row-test-helpers";
import { decodeCursor, encodeCursor } from "../../internal/cursor";
import { mediaTypeSchema } from "@ent-mcp/shared";

beforeEach(() => __clearSimilarFeedCacheForTests());

const cursorSchema = z.object({
  seedId: z.string().min(1),
  seedType: mediaTypeSchema,
  offset: z.number().int().min(0),
});

function historyEntry(
  overrides: Partial<{
    tmdbId: string;
    mediaType: "movie" | "tv";
    watchedAt: number;
  }> = {},
) {
  return {
    tmdbId: overrides.tmdbId ?? "100",
    mediaType: overrides.mediaType ?? ("movie" as const),
    watchedAt: overrides.watchedAt ?? Date.parse("2026-04-01T00:00:00Z"),
    sourceConnectionId: "c1",
    episodeKey: null,
    progress: null,
  };
}

describe("rows/because-you-watched", () => {
  it("eligibility false when history is empty", async () => {
    const ctx = makeRowCtx();
    (
      ctx.catalog as unknown as { getUserHistory: { mockResolvedValue: (v: unknown) => void } }
    ).getUserHistory.mockResolvedValue([]);
    expect(await provider.eligibility(ctx)).toBe(false);
  });

  it("eligibility false when history exists but metadata capability is missing", async () => {
    const ctx = makeRowCtx();
    (
      ctx.catalog as unknown as { getUserHistory: { mockResolvedValue: (v: unknown) => void } }
    ).getUserHistory.mockResolvedValue([historyEntry()]);
    (
      ctx.mediaService as unknown as {
        hasCapabilityProvider: { mockResolvedValue: (v: unknown) => void };
      }
    ).hasCapabilityProvider.mockResolvedValue(false);
    expect(await provider.eligibility(ctx)).toBe(false);
  });

  it("initialCursor encodes the most-recent history seed", async () => {
    const ctx = makeRowCtx();
    (
      ctx.catalog as unknown as { getUserHistory: { mockResolvedValue: (v: unknown) => void } }
    ).getUserHistory.mockResolvedValue([
      historyEntry({ tmdbId: "old", watchedAt: 1 }),
      historyEntry({ tmdbId: "fresh", watchedAt: 2 }),
    ]);

    const cursor = await provider.initialCursor(ctx);
    expect(cursor).not.toBeNull();
    expect(decodeCursor(cursor!, cursorSchema).seedId).toBe("fresh");
  });

  it("breaks watchedAt ties by selecting the highest-rated history entry as seed", async () => {
    const ctx = makeRowCtx();
    const sameDay = Date.parse("2026-04-15T00:00:00Z");
    (
      ctx.catalog as unknown as { getUserHistory: { mockResolvedValue: (v: unknown) => void } }
    ).getUserHistory.mockResolvedValue([
      historyEntry({ tmdbId: "lower", watchedAt: sameDay }),
      historyEntry({ tmdbId: "higher", watchedAt: sameDay }),
    ]);
    (
      ctx.catalog as unknown as { getUserRatings: { mockResolvedValue: (v: unknown) => void } }
    ).getUserRatings.mockResolvedValue([
      { tmdbId: "lower", mediaType: "movie", rating: 6, ratedAt: 0, sourceConnectionId: "c" },
      { tmdbId: "higher", mediaType: "movie", rating: 9, ratedAt: 0, sourceConnectionId: "c" },
    ]);

    const cursor = await provider.initialCursor(ctx);
    expect(decodeCursor(cursor!, cursorSchema).seedId).toBe("higher");
  });

  it("paginates the similar feed and writes seedTitle on ctx", async () => {
    const ctx = makeRowCtx();
    (
      ctx.mediaService as unknown as {
        getSimilarFeed: { mockResolvedValue: (v: unknown) => void };
      }
    ).getSimilarFeed.mockResolvedValue({
      items: Array.from({ length: 25 }, (_, n) => libraryItem({ tmdbId: String(n) })),
      partial: false,
    });
    (
      ctx.catalog as unknown as { getMetadata: { mockResolvedValue: (v: unknown) => void } }
    ).getMetadata.mockResolvedValue({
      tmdbId: "100",
      mediaType: "movie",
      title: "Heat",
      year: 1995,
      runtimeMinutes: 170,
      posterUrl: null,
      backdropUrl: null,
      clearLogoUrl: null,
      overview: null,
      originalLanguage: null,
      genres: ["Crime"],
      features: null,
      lastRefreshedAt: 0,
      lastAccessedAt: 0,
      createdAt: 0,
    });
    (
      ctx.catalog as unknown as {
        getMetadataBatch: { mockResolvedValue: (v: unknown) => void };
      }
    ).getMetadataBatch.mockResolvedValue(
      Object.fromEntries(
        Array.from({ length: 12 }, (_, n) => [
          `movie:${n}`,
          {
            tmdbId: String(n),
            mediaType: "movie",
            title: `Sim ${n}`,
            year: null,
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
        ]),
      ),
    );

    const cursor = encodeCursor({ seedId: "100", seedType: "movie", offset: 0 });
    const page = await provider.fetchPage(ctx, cursor);
    expect(page.items).toHaveLength(12);
    expect(page.cursor).not.toBeNull();
    expect(decodeCursor(page.cursor!, cursorSchema).offset).toBe(12);
    expect(ctx.seedTitle).toBe("Heat");
  });
});
