import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import provider from "../trending-now";
import { makeRowCtx } from "../../__tests__/row-test-helpers";
import { decodeCursor } from "../../internal/cursor";
import type { CanonicalMetadata, MetadataKey } from "@ent-mcp/shared/catalog";

const offsetSchema = z.object({ offset: z.number().int().min(0) });

function meta(tmdbId: string, mediaType: "movie" | "tv" = "movie"): CanonicalMetadata {
  return {
    tmdbId,
    mediaType,
    title: `T${tmdbId}`,
    year: 2024,
    runtimeMinutes: 100,
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

describe("rows/trending-now", () => {
  it("eligibility=false when no snapshot for today", async () => {
    const ctx = makeRowCtx();
    expect(await provider.eligibility(ctx)).toBe(false);
  });

  it("paginates by offset against the day snapshot", async () => {
    const ctx = makeRowCtx();
    const snap: MetadataKey[] = Array.from({ length: 30 }, (_, n) => ({
      tmdbId: String(n),
      type: "movie",
    }));
    (
      ctx.catalog as unknown as { getDiscoverFeed: { mockResolvedValue: (v: unknown) => void } }
    ).getDiscoverFeed.mockResolvedValue(snap);
    (
      ctx.catalog as unknown as {
        getMetadataBatch: {
          mockResolvedValue: (v: unknown) => void;
          mockImplementation: (fn: unknown) => void;
        };
      }
    ).getMetadataBatch.mockImplementation(async (keys: MetadataKey[]) =>
      Object.fromEntries(keys.map((k) => [`movie:${k.tmdbId}`, meta(k.tmdbId)])),
    );

    const first = await provider.fetchPage(ctx, null);
    expect(first.items).toHaveLength(12);
    expect(first.cursor).not.toBeNull();
    expect(decodeCursor(first.cursor!, offsetSchema)).toEqual({ offset: 12 });
    const second = await provider.fetchPage(ctx, first.cursor);
    expect(second.items).toHaveLength(12);
    const third = await provider.fetchPage(ctx, second.cursor);
    expect(third.items).toHaveLength(6);
    expect(third.cursor).toBeNull();
  });
});
