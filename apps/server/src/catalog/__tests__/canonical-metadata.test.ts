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
import type { CanonicalMetadata, MetadataKey } from "@nama/shared/catalog";

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

  it("toCanonicalRow lifts backdropUrl from raw shape", () => {
    const row = toCanonicalRow(KEY_FIGHT_CLUB, {
      title: "Fight Club",
      type: "movie",
      keywords: [],
      cast: [],
      director: null,
      writers: [],
      creators: [],
      genres: [],
      ids: { tmdb_id: "550" },
      posterUrl: "https://image.tmdb.org/t/p/w500/p.jpg",
      backdropUrl: "https://image.tmdb.org/t/p/w1280/bd.jpg",
    });
    expect(row.posterUrl).toBe("https://image.tmdb.org/t/p/w500/p.jpg");
    expect(row.backdropUrl).toBe("https://image.tmdb.org/t/p/w1280/bd.jpg");
  });

  it("toCanonicalRow leaves backdropUrl null when raw lacks it", () => {
    const row = toCanonicalRow(KEY_FIGHT_CLUB, {
      title: "Fight Club",
      type: "movie",
      keywords: [],
      cast: [],
      director: null,
      writers: [],
      creators: [],
      genres: [],
      ids: { tmdb_id: "550" },
    });
    expect(row.backdropUrl).toBeNull();
  });

  it("toCanonicalRow threads collection id and name onto the row", () => {
    // The collections lens groups titles by TMDB franchise, so the plugin's
    // `mediaItem.collection` must land on the canonical row verbatim. If this
    // mapping is dropped, every movie reads as standalone and the lens breaks.
    const row = toCanonicalRow(KEY_FIGHT_CLUB, {
      title: "Fight Club",
      type: "movie",
      keywords: [],
      cast: [],
      director: null,
      writers: [],
      creators: [],
      genres: [],
      ids: { tmdb_id: "550" },
      collection: { id: "131635", name: "The Fight Club Collection" },
    });
    expect(row.collectionId).toBe("131635");
    expect(row.collectionName).toBe("The Fight Club Collection");
  });

  it("toCanonicalRow leaves collection columns null when raw lacks a collection", () => {
    // Standalone titles and all TV carry no collection; those rows must read
    // back as null so the collections lens excludes them rather than inventing
    // an empty-named franchise. A non-null default here would corrupt the lens.
    const row = toCanonicalRow(KEY_TWIN_PEAKS, {
      title: "Twin Peaks",
      type: "tv",
      keywords: [],
      cast: [],
      director: null,
      writers: [],
      creators: [],
      genres: [],
      ids: { tmdb_id: "1400" },
    });
    expect(row.collectionId).toBeNull();
    expect(row.collectionName).toBeNull();
  });

  it("persists collection membership through writeMetadata and reads it back", async () => {
    // Round-trips through the DB to prove the collection columns are not just
    // computed in memory but actually written and selected back. This fails if
    // `toCanonicalRow` stops emitting the columns or the schema drops them.
    const catalog = new CatalogService(await createInMemoryDb());
    const row = buildRow(KEY_FIGHT_CLUB, {
      collectionId: "131635",
      collectionName: "The Fight Club Collection",
    });
    await catalog.writeMetadata([row]);

    const fetched = await catalog.getMetadata("550", "movie");
    expect(fetched?.collectionId).toBe("131635");
    expect(fetched?.collectionName).toBe("The Fight Club Collection");
  });

  it("refreshes collection membership on a conflict UPDATE, not just a fresh insert", async () => {
    // The metadata-refresh job re-writes already-cached rows, hitting the
    // `onConflictDoUpdate` path. If that SET clause omits the collection
    // columns, franchise data first learned on a re-fetch never persists. This
    // writes a row with no collection, then re-writes the same key with one,
    // and proves the update lands.
    const catalog = new CatalogService(await createInMemoryDb());
    await catalog.writeMetadata([buildRow(KEY_FIGHT_CLUB)]);
    const before = await catalog.getMetadata("550", "movie");
    expect(before?.collectionId).toBeNull();

    await catalog.writeMetadata([
      buildRow(KEY_FIGHT_CLUB, {
        collectionId: "131635",
        collectionName: "The Fight Club Collection",
      }),
    ]);

    const after = await catalog.getMetadata("550", "movie");
    expect(after?.collectionId).toBe("131635");
    expect(after?.collectionName).toBe("The Fight Club Collection");
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
