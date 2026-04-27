import { afterAll, describe, expect, it } from "vite-plus/test";
import { sql } from "drizzle-orm";
import { cleanupInMemoryDbs, createInMemoryDb } from "../../__tests__/helpers/in-memory-db";
import { CatalogService } from "../service";
import {
  canonicalMetadata,
  discoverSnapshots,
  recommendationLists,
  userHistoryMirror,
  userRatingsMirror,
} from "../../db/schema/catalog";

afterAll(() => cleanupInMemoryDbs());

describe("catalog phase 1 scaffold", () => {
  it("creates the five catalog tables and the preference_profiles.version column", async () => {
    const db = await createInMemoryDb();

    // Tables should be queryable straight after migration. We do not assert on
    // contents — only that the schema migration ran end-to-end.
    expect(await db.select().from(canonicalMetadata)).toEqual([]);
    expect(await db.select().from(discoverSnapshots)).toEqual([]);
    expect(await db.select().from(recommendationLists)).toEqual([]);
    expect(await db.select().from(userHistoryMirror)).toEqual([]);
    expect(await db.select().from(userRatingsMirror)).toEqual([]);

    const versionInfo = await db.all<{ name: string; dflt_value: string | null }>(
      sql`PRAGMA table_info(${sql.raw("preference_profiles")})`,
    );
    const versionCol = versionInfo.find((row) => row.name === "version");
    expect(versionCol).toBeDefined();
    expect(versionCol?.dflt_value).toBe("0");
  });

  it("constructs a CatalogService with the expected stubbed surface", async () => {
    const db = await createInMemoryDb();
    const catalog = new CatalogService(db);

    expect(await catalog.getMetadata("1", "movie")).toBeNull();
    expect(await catalog.getMetadataBatch([{ tmdbId: "1", type: "movie" }])).toEqual({});
    expect(await catalog.getMetadataWithIds("1", "movie")).toBeNull();
    expect(await catalog.getDiscoverFeed("trending", "popularity_desc", 0)).toBeNull();
    expect(await catalog.getRecommendations("u1")).toBeNull();
    expect(await catalog.getUserHistory("u1")).toEqual([]);
    expect(await catalog.getUserRatings("u1")).toEqual([]);
    expect(await catalog.getHistoryCursors("u1")).toEqual({});
    expect(await catalog.getRatingsCursors("u1")).toEqual({});
    expect(await catalog.listStaleMetadata(0, 10)).toEqual([]);
    expect(await catalog.pruneUnusedMetadata(0)).toEqual({ deleted: 0 });
    expect(await catalog.pruneOldDiscoverSnapshots(0)).toEqual({ deleted: 0 });
  });

  it("exposes a configurable record-access throttle", async () => {
    const db = await createInMemoryDb();
    const defaultCatalog = new CatalogService(db);
    const customCatalog = new CatalogService(db, { recordAccessThrottleMs: 1234 });

    expect(defaultCatalog.recordAccessThrottleMs).toBe(60 * 60 * 1000);
    expect(customCatalog.recordAccessThrottleMs).toBe(1234);
  });
});
