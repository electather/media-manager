import { afterAll, describe, expect, it } from "vite-plus/test";
import { cleanupInMemoryDbs, createInMemoryDb } from "../../__tests__/helpers/in-memory-db";
import { CatalogService } from "../service";
import { toCanonicalRow } from "../canonical";
import type { CanonicalMetadata, MetadataKey } from "../types";

afterAll(() => cleanupInMemoryDbs());

const KEY_FIGHT_CLUB: MetadataKey = { tmdbId: "550", type: "movie" };
const KEY_TWIN_PEAKS: MetadataKey = { tmdbId: "1400", type: "tv" };

function buildRow(key: MetadataKey, overrides: Partial<CanonicalMetadata> = {}): CanonicalMetadata {
  const now = Date.now();
  return {
    ...toCanonicalRow(
      key,
      {
        title: `${key.type} ${key.tmdbId}`,
        type: key.type,
        keywords: ["dark", "thriller"],
        cast: ["Edward Norton"],
        director: "David Fincher",
        writers: ["Jim Uhls"],
        creators: [],
        genres: ["Drama"],
        originalLanguage: "en",
        runtime: 139,
        year: 1999,
        ids: { tmdb_id: key.tmdbId },
      },
      now,
    ),
    ...overrides,
  };
}

describe("CatalogService canonical_metadata", () => {
  it("round-trips a single row via getMetadata", async () => {
    const catalog = new CatalogService(await createInMemoryDb());
    const row = buildRow(KEY_FIGHT_CLUB);
    await catalog.writeMetadata([row]);
    const fetched = await catalog.getMetadata("550", "movie");
    expect(fetched?.title).toBe(row.title);
    expect(fetched?.features?.director).toBe("David Fincher");
    expect(fetched?.features?.cast).toEqual(["Edward Norton"]);
  });

  it("returns null for unknown keys", async () => {
    const catalog = new CatalogService(await createInMemoryDb());
    expect(await catalog.getMetadata("missing", "movie")).toBeNull();
  });

  it("preserves created_at across an INSERT-OR-REPLACE update", async () => {
    const db = await createInMemoryDb();
    const catalog = new CatalogService(db);
    const original = buildRow(KEY_FIGHT_CLUB, {
      createdAt: 1,
      lastRefreshedAt: 1,
      lastAccessedAt: 1,
    });
    await catalog.writeMetadata([original]);

    const refreshed = buildRow(KEY_FIGHT_CLUB, {
      createdAt: 999,
      lastRefreshedAt: 999,
      lastAccessedAt: 999,
      title: "Refreshed",
    });
    await catalog.writeMetadata([refreshed]);

    const fetched = await catalog.getMetadata("550", "movie");
    expect(fetched?.title).toBe("Refreshed");
    expect(fetched?.createdAt).toBe(1);
    expect(fetched?.lastRefreshedAt).toBe(999);
  });

  it("batches reads keyed by `${type}:${tmdbId}`", async () => {
    const catalog = new CatalogService(await createInMemoryDb());
    await catalog.writeMetadata([buildRow(KEY_FIGHT_CLUB), buildRow(KEY_TWIN_PEAKS)]);
    const map = await catalog.getMetadataBatch([
      KEY_FIGHT_CLUB,
      KEY_TWIN_PEAKS,
      { tmdbId: "missing", type: "movie" },
    ]);
    expect(Object.keys(map).sort()).toEqual(["movie:550", "tv:1400"]);
  });

  it("returns an empty object when called with no keys", async () => {
    const catalog = new CatalogService(await createInMemoryDb());
    expect(await catalog.getMetadataBatch([])).toEqual({});
  });

  it("surfaces NULL-features rows ahead of time-stale rows", async () => {
    const catalog = new CatalogService(await createInMemoryDb());
    const now = Date.now();
    // KEY_FIGHT_CLUB is time-stale; KEY_TWIN_PEAKS has fresh refresh time
    // but NULL features (a typical Phase 3 discover-snapshot side-effect).
    // The NULL-features row must surface first so it actually gets enriched
    // when many rows are queued ahead of it.
    const timeStale = buildRow(KEY_FIGHT_CLUB, { lastRefreshedAt: now - 60 * 24 * 60 * 60 * 1000 });
    const nullFeatures = buildRow(KEY_TWIN_PEAKS, { features: null, lastRefreshedAt: now });
    await catalog.writeMetadata([timeStale, nullFeatures]);

    const keys = await catalog.listStaleMetadata(30 * 24 * 60 * 60 * 1000, 10);
    const fightClubIdx = keys.findIndex((k) => k.tmdbId === "550" && k.type === "movie");
    const twinPeaksIdx = keys.findIndex((k) => k.tmdbId === "1400" && k.type === "tv");
    expect(fightClubIdx).toBeGreaterThanOrEqual(0);
    expect(twinPeaksIdx).toBeGreaterThanOrEqual(0);
    expect(twinPeaksIdx).toBeLessThan(fightClubIdx);
  });
});
