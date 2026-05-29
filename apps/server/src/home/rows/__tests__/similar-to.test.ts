import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import provider from "../similar-to";
import { __clearSimilarFeedCacheForTests } from "../_shared";
import { libraryItem, makeRowCtx } from "../../__tests__/row-test-helpers";
import { decode, type Cursor } from "../../../media";

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

vi.mock("../../../media", async () => {
  const actual = await vi.importActual<typeof import("../../../media")>("../../../media");
  return {
    ...actual,
    enrichCompactItems: vi.fn(async (items: unknown[]) => ({ items, partial: false })),
  };
});

beforeEach(() => __clearSimilarFeedCacheForTests());

function seedOf(cursorStr: string): { seedId: string; seedType: string; offset: number } {
  const cursor = decode(cursorStr, "keyset");
  if (!cursor || cursor.mode !== "keyset") throw new Error("expected keyset cursor");
  return JSON.parse(cursor.k) as { seedId: string; seedType: string; offset: number };
}

function seedCursor(seedId: string, seedType: "movie" | "tv", offset = 0): Cursor {
  return { mode: "keyset", k: JSON.stringify({ seedId, seedType, offset }) };
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

    const page = await provider.load(ctx, seedCursor("550", "movie"));

    expect(page.items).toHaveLength(12);
    expect(page.cursor).not.toBeNull();
    expect(seedOf(page.cursor!).offset).toBe(12);
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

    const page = await provider.load(ctx, seedCursor("100", "tv"));

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

    const page = await provider.load(ctx, seedCursor("1", "movie"));
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

    await provider.load(ctx, seedCursor("1396", "tv"));

    const [callArg] = getSimilarFeed.mock.calls[0] as [{ id: string; type: string }];
    expect(callArg.id).toBe("1396");
    expect(callArg.type).toBe("tv");
  });
});
