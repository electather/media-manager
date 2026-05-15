import { beforeEach, describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import provider from "../similar-to";
import { __clearSimilarFeedCacheForTests } from "../_shared";
import { libraryItem, makeRowCtx } from "../../__tests__/row-test-helpers";
import { decodeCursor, encodeCursor } from "../../cursor";
import { mediaTypeSchema } from "@ent-mcp/shared";

beforeEach(() => __clearSimilarFeedCacheForTests());

const cursorSchema = z.object({
  tmdbId: z.string().min(1),
  mediaType: mediaTypeSchema,
  offset: z.number().int().min(0),
});

function makeCursor(tmdbId: string, mediaType: "movie" | "tv", offset = 0): string {
  return encodeCursor({ tmdbId, mediaType, offset });
}

describe("rows/similar-to", () => {
  it("eligibility is true when metadata capability is present", async () => {
    const ctx = makeRowCtx();
    (
      ctx.mediaService as unknown as {
        hasCapabilityProvider: { mockResolvedValue: (v: unknown) => void };
      }
    ).hasCapabilityProvider.mockResolvedValue(true);
    expect(await provider.eligibility(ctx)).toBe(true);
  });

  it("eligibility is false when metadata capability is missing", async () => {
    const ctx = makeRowCtx();
    (
      ctx.mediaService as unknown as {
        hasCapabilityProvider: { mockResolvedValue: (v: unknown) => void };
      }
    ).hasCapabilityProvider.mockResolvedValue(false);
    expect(await provider.eligibility(ctx)).toBe(false);
  });

  it("requiresInitialCursor is set so the orchestrator rejects null cursors", () => {
    expect(provider.requiresInitialCursor).toBe(true);
  });

  it("initialCursor returns null — the client supplies the seed", async () => {
    const ctx = makeRowCtx();
    expect(await provider.initialCursor(ctx)).toBeNull();
  });

  it("fetches similar items for the seed and sets seedTitle on ctx", async () => {
    const ctx = makeRowCtx();
    (
      ctx.mediaService as unknown as {
        getSimilarFeed: { mockResolvedValue: (v: unknown) => void };
      }
    ).getSimilarFeed.mockResolvedValue({
      items: Array.from({ length: 20 }, (_, n) => libraryItem({ tmdbId: String(n) })),
      partial: false,
    });
    (
      ctx.catalog as unknown as { getMetadata: { mockResolvedValue: (v: unknown) => void } }
    ).getMetadata.mockResolvedValue({
      tmdbId: "550",
      mediaType: "movie",
      title: "Fight Club",
      year: 1999,
      runtimeMinutes: 139,
      posterUrl: null,
      backdropUrl: null,
      clearLogoUrl: null,
      overview: null,
      originalLanguage: null,
      genres: ["Drama"],
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

    const cursor = makeCursor("550", "movie");
    const page = await provider.fetchPage(ctx, cursor);

    expect(page.items).toHaveLength(12);
    expect(page.cursor).not.toBeNull();
    expect(decodeCursor(page.cursor!, cursorSchema).offset).toBe(12);
    expect(ctx.seedTitle).toBe("Fight Club");
  });

  it("returns null next cursor when the feed is exhausted", async () => {
    const ctx = makeRowCtx();
    (
      ctx.mediaService as unknown as {
        getSimilarFeed: { mockResolvedValue: (v: unknown) => void };
      }
    ).getSimilarFeed.mockResolvedValue({
      items: Array.from({ length: 5 }, (_, n) => libraryItem({ tmdbId: String(n) })),
      partial: false,
    });
    (
      ctx.catalog as unknown as {
        getMetadataBatch: { mockResolvedValue: (v: unknown) => void };
      }
    ).getMetadataBatch.mockResolvedValue({});

    const cursor = makeCursor("100", "tv");
    const page = await provider.fetchPage(ctx, cursor);

    expect(page.cursor).toBeNull();
  });

  it("propagates partial: true when the similar feed signals a partial result", async () => {
    const ctx = makeRowCtx();
    (
      ctx.mediaService as unknown as {
        getSimilarFeed: { mockResolvedValue: (v: unknown) => void };
      }
    ).getSimilarFeed.mockResolvedValue({ items: [], partial: true });
    (
      ctx.catalog as unknown as {
        getMetadataBatch: { mockResolvedValue: (v: unknown) => void };
      }
    ).getMetadataBatch.mockResolvedValue({});

    const page = await provider.fetchPage(ctx, makeCursor("1", "movie"));
    expect(page.partial).toBe(true);
  });

  it("passes the seed tmdbId to getSimilarFeed", async () => {
    const ctx = makeRowCtx();
    const getSimilarFeed = (
      ctx.mediaService as unknown as {
        getSimilarFeed: { mockResolvedValue: (v: unknown) => void; mock: { calls: unknown[][] } };
      }
    ).getSimilarFeed;
    getSimilarFeed.mockResolvedValue({ items: [], partial: false });
    (
      ctx.catalog as unknown as {
        getMetadataBatch: { mockResolvedValue: (v: unknown) => void };
      }
    ).getMetadataBatch.mockResolvedValue({});

    await provider.fetchPage(ctx, makeCursor("1396", "tv"));

    const [callArg] = getSimilarFeed.mock.calls[0] as [{ id: string; type: string }];
    expect(callArg.id).toBe("1396");
    expect(callArg.type).toBe("tv");
  });
});
