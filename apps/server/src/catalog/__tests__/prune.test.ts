import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

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

import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../__tests__/helpers/in-memory-db";
import { CatalogService } from "../service";
import { toCanonicalRow } from "../canonical";
import type { MetadataKey, RecItem } from "../types";
import { seedUser } from "./helpers";

afterAll(() => cleanupInMemoryDbs());

const DAY_MS = 24 * 60 * 60 * 1000;

describe("CatalogService.pruneUnusedMetadata", () => {
  let catalog: CatalogService;
  let db: Db;

  beforeEach(async () => {
    db = await createInMemoryDb();
    catalog = new CatalogService(db);
  });

  it("drops cold rows that no rec list or recent snapshot references", async () => {
    const now = Date.now();
    const cold = toCanonicalRow(
      { tmdbId: "1", type: "movie" },
      { title: "Cold", type: "movie", ids: { tmdb_id: "1" } },
      now - 200 * DAY_MS,
    );
    // Skip the "row exists" pre-check — `getMetadata` calls `recordAccess`
    // and bumps `last_accessed_at` past the cutoff, defeating the prune.
    await catalog.writeMetadata([cold]);

    const result = await catalog.pruneUnusedMetadata(90 * DAY_MS);

    expect(result.deleted).toBe(1);
    expect(await new CatalogService(db).getMetadata("1", "movie")).toBeNull();
  });

  it("retains cold rows referenced by an active recommendation list", async () => {
    const now = Date.now();
    await seedUser(db, "u1");
    const cold = toCanonicalRow(
      { tmdbId: "1", type: "movie" },
      { title: "Pinned", type: "movie", ids: { tmdb_id: "1" } },
      now - 200 * DAY_MS,
    );
    await catalog.writeMetadata([cold]);
    const items: RecItem[] = [
      { tmdbId: "1", mediaType: "movie", matchReason: null, topContributors: [], score: 0.9 },
    ];
    await catalog.writeRecommendationList("u1", "default", items, 1);

    const result = await catalog.pruneUnusedMetadata(90 * DAY_MS);

    expect(result.deleted).toBe(0);
    expect(await new CatalogService(db).getMetadata("1", "movie")).not.toBeNull();
  });

  it("retains cold rows referenced by a discover snapshot from the last 7 days", async () => {
    const now = Date.now();
    const today = Math.floor(now / DAY_MS) * DAY_MS;
    const cold = toCanonicalRow(
      { tmdbId: "1", type: "movie" },
      { title: "Trending", type: "movie", ids: { tmdb_id: "1" } },
      now - 200 * DAY_MS,
    );
    await catalog.writeMetadata([cold]);
    const refs: MetadataKey[] = [{ tmdbId: "1", type: "movie" }];
    await catalog.writeDiscoverSnapshot("trending", "popularity_desc", today, refs);

    const result = await catalog.pruneUnusedMetadata(90 * DAY_MS);

    expect(result.deleted).toBe(0);
    expect(await new CatalogService(db).getMetadata("1", "movie")).not.toBeNull();
  });

  it("respects an explicit refSet argument over the default ref derivation", async () => {
    const now = Date.now();
    const cold = toCanonicalRow(
      { tmdbId: "1", type: "movie" },
      { title: "Forced-pin", type: "movie", ids: { tmdb_id: "1" } },
      now - 200 * DAY_MS,
    );
    await catalog.writeMetadata([cold]);

    const result = await catalog.pruneUnusedMetadata(90 * DAY_MS, new Set(["movie:1"]));

    expect(result.deleted).toBe(0);
  });
});
