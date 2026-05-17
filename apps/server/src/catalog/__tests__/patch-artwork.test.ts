import { afterAll, describe, expect, it, vi } from "vite-plus/test";

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

import { cleanupInMemoryDbs, createInMemoryDb } from "../../__tests__/helpers/in-memory-db";
import { CatalogService } from "../service";
import { toCanonicalRow } from "../canonical";
import type { CanonicalMetadata, MetadataKey } from "@ent-mcp/shared/catalog";

afterAll(() => cleanupInMemoryDbs());

const KEY: MetadataKey = { tmdbId: "550", type: "movie" };

function buildRow(overrides: Partial<CanonicalMetadata> = {}): CanonicalMetadata {
  const base = toCanonicalRow(
    KEY,
    {
      title: "Fight Club",
      type: "movie",
      keywords: [],
      cast: [],
      director: null,
      writers: [],
      creators: [],
      genres: [],
      ids: { tmdb_id: "550" },
    },
    1_000,
  );
  return { ...base, ...overrides };
}

describe("CatalogService.patchArtwork", () => {
  it("populates every null artwork column", async () => {
    const catalog = new CatalogService(await createInMemoryDb());
    await catalog.writeMetadata([buildRow()]);

    await catalog.patchArtwork(KEY, {
      posterUrl: "p.jpg",
      backdropUrl: "b.jpg",
      clearLogoUrl: "cl.png",
    });

    const fetched = await catalog.getMetadata("550", "movie");
    expect(fetched?.posterUrl).toBe("p.jpg");
    expect(fetched?.backdropUrl).toBe("b.jpg");
    expect(fetched?.clearLogoUrl).toBe("cl.png");
  });

  it("preserves filled columns via COALESCE", async () => {
    const catalog = new CatalogService(await createInMemoryDb());
    await catalog.writeMetadata([buildRow({ posterUrl: "existing-poster.jpg" })]);

    await catalog.patchArtwork(KEY, {
      posterUrl: "new-poster.jpg",
      backdropUrl: "b.jpg",
      clearLogoUrl: "cl.png",
    });

    const fetched = await catalog.getMetadata("550", "movie");
    expect(fetched?.posterUrl).toBe("existing-poster.jpg");
    expect(fetched?.backdropUrl).toBe("b.jpg");
    expect(fetched?.clearLogoUrl).toBe("cl.png");
  });

  it("is a no-op when row is absent (no throw)", async () => {
    const catalog = new CatalogService(await createInMemoryDb());
    await expect(
      catalog.patchArtwork(KEY, { posterUrl: "p.jpg", backdropUrl: null, clearLogoUrl: null }),
    ).resolves.toBeUndefined();
    expect(await catalog.getMetadata("550", "movie")).toBeNull();
  });

  it("bumps last_refreshed_at on a successful patch", async () => {
    const catalog = new CatalogService(await createInMemoryDb());
    await catalog.writeMetadata([buildRow({ lastRefreshedAt: 1_000 })]);

    const before = await catalog.getMetadata("550", "movie");
    expect(before?.lastRefreshedAt).toBe(1_000);

    await catalog.patchArtwork(KEY, { posterUrl: "p.jpg" });

    const after = await catalog.getMetadata("550", "movie");
    expect(after?.lastRefreshedAt).toBeGreaterThan(1_000);
  });

  it("first writer wins on null cols across two sequential patches", async () => {
    const catalog = new CatalogService(await createInMemoryDb());
    await catalog.writeMetadata([buildRow()]);

    await catalog.patchArtwork(KEY, {
      posterUrl: "first-poster.jpg",
      backdropUrl: null,
      clearLogoUrl: null,
    });
    await catalog.patchArtwork(KEY, {
      posterUrl: "second-poster.jpg",
      backdropUrl: "second-backdrop.jpg",
      clearLogoUrl: null,
    });

    const fetched = await catalog.getMetadata("550", "movie");
    expect(fetched?.posterUrl).toBe("first-poster.jpg");
    expect(fetched?.backdropUrl).toBe("second-backdrop.jpg");
    expect(fetched?.clearLogoUrl).toBeNull();
  });

  it("ignores undefined slots without clobbering existing values", async () => {
    const catalog = new CatalogService(await createInMemoryDb());
    await catalog.writeMetadata([
      buildRow({
        posterUrl: "existing.jpg",
        backdropUrl: "existing-bd.jpg",
        clearLogoUrl: null,
      }),
    ]);

    await catalog.patchArtwork(KEY, { clearLogoUrl: "cl.png" });

    const fetched = await catalog.getMetadata("550", "movie");
    expect(fetched?.posterUrl).toBe("existing.jpg");
    expect(fetched?.backdropUrl).toBe("existing-bd.jpg");
    expect(fetched?.clearLogoUrl).toBe("cl.png");
  });
});
