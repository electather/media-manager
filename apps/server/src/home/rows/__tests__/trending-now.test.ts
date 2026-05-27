import { describe, expect, it, vi } from "vite-plus/test";
import provider from "../trending-now";
import { makeRowCtx } from "../../__tests__/row-test-helpers";
import { decode } from "../../../media";
import type { CanonicalMetadata, MetadataKey } from "@ent-mcp/shared/catalog";

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

// Media owns enrichment (1:1 + order-preserving); a pass-through pins the test
// to the row-fetch + pipeline slice behavior without standing up the
// artwork/status fan-out.
vi.mock("../../../media", async () => {
  const actual = await vi.importActual<typeof import("../../../media")>("../../../media");
  return {
    ...actual,
    enrichCompactItems: vi.fn(async (items: unknown[]) => ({ items, partial: false })),
  };
});

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

  it("paginates by offset against the day snapshot through the shared pipeline", async () => {
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
        getMetadataBatch: { mockImplementation: (fn: unknown) => void };
      }
    ).getMetadataBatch.mockImplementation(async (keys: MetadataKey[]) =>
      Object.fromEntries(keys.map((k) => [`movie:${k.tmdbId}`, meta(k.tmdbId)])),
    );

    // The source returns the full snapshot; `media.listRows` (offset mode) owns
    // the slice + cursor — page 1 yields 12 items and a cursor at offset 12.
    const first = await provider.load(ctx, null);
    expect(first.items).toHaveLength(12);
    expect(first.cursor).not.toBeNull();
    const firstCursor = decode(first.cursor!, "offset");
    expect(firstCursor).toEqual({ mode: "offset", n: 12 });
    const second = await provider.load(ctx, firstCursor);
    expect(second.items).toHaveLength(12);
    const third = await provider.load(ctx, decode(second.cursor!, "offset"));
    expect(third.items).toHaveLength(6);
    expect(third.cursor).toBeNull();
  });
});
