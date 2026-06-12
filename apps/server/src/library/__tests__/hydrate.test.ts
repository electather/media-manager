import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { consola, type ConsolaInstance } from "consola";
import { and, eq } from "drizzle-orm";
import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../__tests__/helpers/in-memory-db";
import { user } from "../../db/schema/auth";
import { libraryItems } from "../../db/schema/library";

// The hydrate orchestrator resolves its database handle through `getDb()` and
// drives the real `staleOrNew`/`writeHydration` repo functions. Point `getDb`
// at the migrated in-memory database (which applies every drizzle migration,
// including `library_items`) so the denormalized columns are written and read
// back against actual SQLite — a mocked repo could not prove that the projection
// columns and `hydrated_at` survive a real UPDATE/SELECT round-trip.
vi.mock("../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

vi.mock("../../db/client", async () => {
  const actual = await vi.importActual<typeof import("../../db/client")>("../../db/client");
  return {
    ...actual,
    getDb: () => testDb,
  };
});

// Import the code under test AFTER the mocks are registered so it binds to the
// stubbed `getDb`. The repo and orchestrator are imported real (NOT mocked):
// mocking either would defeat the very invariants these tests guard — that the
// orchestrator folds the stubbed sources into the projection columns and that
// `staleOrNew` selects exactly the missing/stale rows.
const { hydrate } = await import("../internal/hydrate");
const { staleOrNew, writeHydration, upsertOwned, __resetLibraryForTests } = await import("../repo");
const { asLibraryContext } = await import("../internal/context");

let testDb: Db;

const log: ConsolaInstance = consola.withTag("test");

const USER_ID = "u1";

/** A catalog metadata entry as the hydrate orchestrator reads it off `getMetadataBatch`. */
type MetaEntry = {
  title?: string;
  year?: number | null;
  genres?: string[] | null;
  collectionId?: string | null;
  collectionName?: string | null;
};

/** A quality copy as `getAvailabilityQuality` surfaces it, before tier derivation. */
type QualityCopy = { resolution?: string; hdr?: string };

/** A server chip as `getMatchingServers` surfaces it. */
type Server = { id: string; label: string };

/** One continue-watching feed item in the shape `projectProgressMapEntry` parses. */
function cwEntry(tmdbId: string, type: "movie" | "tv", watchedSec: number, totalSec: number) {
  // `progressMs` is the watched position in ms; `durationSec` is the total. An
  // entry with `0 < watched < total` projects to `watchedState: "partial"`.
  return {
    progressMs: watchedSec * 1000,
    item: { type, durationSec: totalSec, ids: { tmdb_id: tmdbId } },
  };
}

/**
 * Stubs the media + catalog services the hydrate orchestrator fans out over and
 * builds the loose `MaybeLibraryContext` the resolver accepts (mirroring
 * `sync.test.ts#makeCtx`). The catalog handle is unused by phase-1 membership
 * sync but is the phase-2 metadata source, so it is a real stub here.
 *
 * Each source is a `vi.fn` so a test can assert fan-out or override per call.
 * Defaults resolve the empty/absent shape so a source a test does not care about
 * never throws and contributes its empty projection.
 */
function makeCtx(opts: {
  metadata?: Record<string, MetaEntry>;
  servers?: Server[];
  quality?: QualityCopy[];
  continueWatching?: unknown[];
}) {
  const mediaService = {
    getMatchingServers: vi.fn().mockResolvedValue(opts.servers ?? []),
    getAvailabilityQuality: vi.fn().mockResolvedValue(opts.quality ?? []),
    // `loadProgressMap` reads the continue-watching aggregate and projects it to
    // the `{ watched, total }` map `deriveWatchedState` consumes.
    getContinueWatchingFeed: vi
      .fn()
      .mockResolvedValue({ items: opts.continueWatching ?? [], partial: false }),
  };
  const catalog = {
    getMetadataBatch: vi.fn().mockResolvedValue(opts.metadata ?? {}),
  };
  const ctx = {
    userId: USER_ID,
    mediaService: mediaService as unknown as Parameters<typeof asLibraryContext>[0]["mediaService"],
    catalog: catalog as unknown as Parameters<typeof asLibraryContext>[0]["catalog"],
    log,
  };
  return { ctx: asLibraryContext(ctx), mediaService, catalog };
}

/** Inserts an owned, never-hydrated library row (the shape membership sync seeds). */
async function seedOwned(tmdbId: string, mediaType: "movie" | "tv" = "movie") {
  await upsertOwned(
    [
      {
        id: `${mediaType}:${tmdbId}`,
        userId: USER_ID,
        tmdbId,
        mediaType,
        ownedAt: Date.now(),
      },
    ],
    testDb,
  );
}

/** Reads a single library row by its composite id, or undefined when absent. */
async function rowById(id: string) {
  const rows = await testDb
    .select()
    .from(libraryItems)
    .where(and(eq(libraryItems.userId, USER_ID), eq(libraryItems.id, id)));
  return rows[0];
}

beforeAll(async () => {
  testDb = await createInMemoryDb();
  await testDb.insert(user).values({
    id: USER_ID,
    name: USER_ID,
    email: `${USER_ID}@test`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
});

afterAll(() => cleanupInMemoryDbs());

beforeEach(async () => {
  await __resetLibraryForTests(testDb);
});

describe("library hydrate (design §Sync + hydrate, phase 2)", () => {
  // HYDRATE WRITES DENORM COLS — the orchestrator must fold all four stubbed
  // sources into the row's denormalized projection and stamp `hydratedAt`.
  // Reading the row back proves each column is sourced correctly: a normalized
  // sortTitle (article stripped, lowercased) from `getMetadataBatch.title`, the
  // year/genres/collection from metadata, the server chips from
  // `getMatchingServers`, the quality tiers derived from
  // `getAvailabilityQuality`, and `watchedState` derived from the CW feed. If
  // the orchestrator ever stopped writing any one column, that assertion fails.
  it("writes every denormalized column from the stubbed sources", async () => {
    await seedOwned("550");

    const { ctx } = makeCtx({
      metadata: {
        "movie:550": {
          title: "The Matrix",
          year: 1999,
          genres: ["Action", "Sci-Fi"],
          collectionId: "c1",
          collectionName: "The Matrix Collection",
        },
      },
      servers: [{ id: "plex", label: "Plex" }],
      // A 4K Dolby-Vision copy derives the "4K HDR" tier; a 1080p copy adds
      // "1080p" — proving `deriveQualityTiers` ran over the stubbed copies.
      quality: [{ resolution: "4k", hdr: "dolby-vision" }, { resolution: "1080p" }],
      // 600s watched of a 6000s title → 0 < watched < total → "partial".
      continueWatching: [cwEntry("550", "movie", 600, 6000)],
    });

    const result = await hydrate(ctx, { staleTtlMs: 1000 });
    expect(result).toEqual({ considered: 1, hydrated: 1 });

    const row = await rowById("movie:550");
    // "The Matrix" → article stripped + lowercased → "matrix".
    expect(row?.sortTitle).toBe("matrix");
    expect(row?.year).toBe(1999);
    expect(row?.genres).toEqual(["Action", "Sci-Fi"]);
    expect(row?.servers).toEqual([{ id: "plex", label: "Plex" }]);
    expect(row?.qualityTiers).toEqual(["4K HDR", "1080p"]);
    expect(row?.watchedState).toBe("partial");
    expect(row?.collectionId).toBe("c1");
    expect(row?.collectionName).toBe("The Matrix Collection");
    // `hydratedAt` is stamped so a later `staleOrNew` skips the row.
    expect(row?.hydratedAt).not.toBeNull();
  });

  // STALE/NEW SELECTION — `staleOrNew` is the read that bounds the whole
  // fan-out, so it MUST select exactly the missing-or-stale owned rows and
  // nothing fresh. Driven directly with an explicit `now` to avoid clock flake.
  // A never-hydrated row (`hydratedAt IS NULL`) is always selected; once
  // `writeHydration` stamps `hydratedAt = T`, the row drops out of the window
  // (`now` inside `[T, T+ttl)`) and reappears only once `now` crosses the TTL.
  // If the predicate widened (e.g. dropped the `hydrated_at < staleBefore`
  // bound), the fresh-window assertion would fail; if it narrowed (dropped the
  // `IS NULL` arm), the new-row assertion would fail.
  it("selects only missing or stale rows for the given now", async () => {
    await seedOwned("550");
    const TTL = 60_000;
    const T = 1_000_000;

    // A never-hydrated row is selected regardless of `now`.
    const fresh = await staleOrNew(USER_ID, TTL, T, testDb);
    expect(fresh.map((t) => t.id)).toEqual(["movie:550"]);

    // Hydrate it at `T` so `hydrated_at = T`.
    await writeHydration(
      USER_ID,
      [
        {
          id: "movie:550",
          sortTitle: "matrix",
          year: 1999,
          genres: [],
          servers: [],
          qualityTiers: [],
          watchedState: null,
          collectionId: null,
          collectionName: null,
        },
      ],
      T,
      testDb,
    );

    // Inside the window (`now` one ms before the TTL elapses) the row is fresh
    // and MUST NOT be re-selected.
    const withinWindow = await staleOrNew(USER_ID, TTL, T + TTL - 1, testDb);
    expect(withinWindow).toEqual([]);

    // Once `now` advances past the TTL the row is stale again and IS selected.
    const pastWindow = await staleOrNew(USER_ID, TTL, T + TTL + 1, testDb);
    expect(pastWindow.map((t) => t.id)).toEqual(["movie:550"]);
  });

  // NULL-SAFE — a row whose metadata batch is missing (the catalog has no
  // canonical row for it yet) must still hydrate the columns it CAN resolve
  // rather than throwing and stalling the whole pass. The metadata-sourced
  // columns fall back to their empty/null shape (sortTitle "", year null,
  // genres [], collection null), while the availability- and progress-sourced
  // columns still populate. This is the partial-hydrate-self-heals invariant: a
  // throw here would mean one missing catalog row poisons every later row in the
  // batch.
  it("hydrates the resolvable columns when the metadata batch is missing", async () => {
    await seedOwned("777");

    // Note: `metadata` is empty (no entry for "movie:777") but servers/quality/CW
    // all resolve, so the row must still hydrate without throwing.
    const { ctx } = makeCtx({
      metadata: {},
      servers: [{ id: "jellyfin", label: "Jellyfin" }],
      quality: [{ resolution: "720p" }],
      continueWatching: [cwEntry("777", "movie", 100, 1000)],
    });

    const result = await hydrate(ctx, { staleTtlMs: 1000 });
    expect(result).toEqual({ considered: 1, hydrated: 1 });

    const row = await rowById("movie:777");
    // Metadata-sourced columns fall back to their empty/null shape.
    expect(row?.sortTitle).toBe("");
    expect(row?.year).toBeNull();
    expect(row?.genres).toEqual([]);
    expect(row?.collectionId).toBeNull();
    expect(row?.collectionName).toBeNull();
    // Availability- and progress-sourced columns still populate.
    expect(row?.servers).toEqual([{ id: "jellyfin", label: "Jellyfin" }]);
    expect(row?.qualityTiers).toEqual(["720p"]);
    expect(row?.watchedState).toBe("partial");
    // The row was still stamped hydrated despite the partial sources.
    expect(row?.hydratedAt).not.toBeNull();
  });
});
