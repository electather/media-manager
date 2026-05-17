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
import type { MetadataKey } from "../types";

afterAll(() => cleanupInMemoryDbs());

const DAY_MS = 24 * 60 * 60 * 1000;

describe("CatalogService discover_snapshots", () => {
  it("round-trips a snapshot keyed on (kind, sort, day)", async () => {
    const catalog = new CatalogService(await createInMemoryDb());
    const day = Math.floor(Date.now() / DAY_MS) * DAY_MS;
    const items: MetadataKey[] = [
      { tmdbId: "1", type: "movie" },
      { tmdbId: "100", type: "tv" },
    ];

    await catalog.writeDiscoverSnapshot("newReleases", "popularity_desc", day, items);
    const fetched = await catalog.getDiscoverFeed("newReleases", "popularity_desc", day);
    expect(fetched).toEqual(items);
  });

  it("returns null when no snapshot exists for the requested day", async () => {
    const catalog = new CatalogService(await createInMemoryDb());
    const fetched = await catalog.getDiscoverFeed("trending", "popularity_desc", 0);
    expect(fetched).toBeNull();
  });

  it("upserts the same key with a fresh items list", async () => {
    const catalog = new CatalogService(await createInMemoryDb());
    const day = 1_000_000;
    await catalog.writeDiscoverSnapshot("popular", "popularity_desc", day, [
      { tmdbId: "1", type: "movie" },
    ]);
    await catalog.writeDiscoverSnapshot("popular", "popularity_desc", day, [
      { tmdbId: "2", type: "movie" },
    ]);
    const fetched = await catalog.getDiscoverFeed("popular", "popularity_desc", day);
    expect(fetched).toEqual([{ tmdbId: "2", type: "movie" }]);
  });

  it("prunes snapshots older than the cutoff", async () => {
    const catalog = new CatalogService(await createInMemoryDb());
    const now = Date.now();
    const today = Math.floor(now / DAY_MS) * DAY_MS;
    const tenDaysAgo = today - 10 * DAY_MS;

    await catalog.writeDiscoverSnapshot("trending", "popularity_desc", today, [
      { tmdbId: "1", type: "movie" },
    ]);
    await catalog.writeDiscoverSnapshot("trending", "popularity_desc", tenDaysAgo, [
      { tmdbId: "2", type: "movie" },
    ]);

    const result = await catalog.pruneOldDiscoverSnapshots(7);
    expect(result.deleted).toBe(1);
    expect(await catalog.getDiscoverFeed("trending", "popularity_desc", today)).not.toBeNull();
    expect(await catalog.getDiscoverFeed("trending", "popularity_desc", tenDaysAgo)).toBeNull();
  });
});
