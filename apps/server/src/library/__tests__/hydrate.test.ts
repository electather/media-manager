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
const { hydrate, HYDRATE_CONCURRENCY } = await import("../internal/hydrate");
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

  // CONCURRENCY CAP — the hydrate pass must process all rows and write every
  // projection even when the stale-row set exceeds HYDRATE_CONCURRENCY (25).
  // This guards the chunked fan-out: if a chunk boundary accidentally dropped
  // rows, `considered` would equal `targets.length` but `hydrated` would be
  // fewer, or some rows would remain un-stamped (`hydratedAt = null`).
  it("hydrates all rows when the stale set exceeds HYDRATE_CONCURRENCY", async () => {
    const COUNT = HYDRATE_CONCURRENCY + 5; // Deliberately larger than HYDRATE_CONCURRENCY.
    for (let i = 0; i < COUNT; i++) {
      await seedOwned(String(1000 + i));
    }

    const { ctx } = makeCtx({});
    const result = await hydrate(ctx, { staleTtlMs: 1000 });
    expect(result.considered).toBe(COUNT);
    expect(result.hydrated).toBe(COUNT);

    // Every row must have been stamped — no row should still have a null hydratedAt.
    for (let i = 0; i < COUNT; i++) {
      const row = await rowById(`movie:${1000 + i}`);
      expect(row?.hydratedAt).not.toBeNull();
    }
  });

  // PER-CHUNK PERSISTENCE — the pass writes each chunk's projection as it
  // resolves rather than buffering every update for one write after the loop.
  // This matters because the scheduled jobs cap a user row at a wall-clock
  // timeout (`runRowWithTimeout` races the handler against 30s/60s) and abandon
  // the row's in-flight work when it fires, while the availability probes run
  // unbounded. If the pass only wrote after the loop, a row that stalled in a
  // later chunk would discard every earlier chunk's completed work and the next
  // run would redo it. Here a never-resolving probe stalls the SECOND chunk
  // (rows 25+), modelling that abandoned-on-timeout row. The gate is
  // deterministic, not wall-clock: chunk 2's first probe only runs once the loop
  // has fully awaited chunk 1's `Promise.all` AND its `writeHydration`, so when
  // that probe fires we KNOW chunk 1 is persisted — no `setTimeout` race that
  // could flake on a loaded runner. We assert the FIRST chunk (rows 0–24) is
  // already stamped (so `staleOrNew` skips it next run) while the stalled
  // second-chunk rows stay un-stamped and are retried. Under a
  // single-write-after-loop design every row would be un-stamped here, failing
  // the first assertion.
  it("persists completed chunks before a later chunk stalls", async () => {
    // One full chunk (HYDRATE_CONCURRENCY rows) plus a partial second chunk, so
    // the loop spans exactly two chunks regardless of the constant's value.
    const COUNT = HYDRATE_CONCURRENCY + 5;
    // Suffixes are zero-padded to a fixed width (mirroring sync.test.ts) so they
    // sort lexicographically == numerically for any COUNT, independent of digit
    // count. `staleOrNew` orders by composite id, so the chunk boundary is then
    // deterministic: the first HYDRATE_CONCURRENCY ids are chunk 1, the rest
    // chunk 2. The per-id assertions below depend on that explicit ordering, not
    // on SQLite's incidental PK order.
    const seedId = (i: number) => `p${String(i).padStart(6, "0")}`;
    for (let i = 0; i < COUNT; i++) {
      await seedOwned(seedId(i));
    }

    // A deferred resolved by chunk 2's first probe. Awaiting it is the
    // deterministic signal that the loop advanced past chunk 1 — i.e. chunk 1's
    // `writeHydration` already committed — so the assertions never race a timer.
    let reachedChunkTwo!: () => void;
    const chunkTwoStarted = new Promise<void>((resolve) => {
      reachedChunkTwo = resolve;
    });

    // The probes resolve normally for chunk 1's HYDRATE_CONCURRENCY rows then hang
    // on the first chunk-2 call, modelling a slow provider that blows the row
    // timeout. `loadAvailability` fires `getMatchingServers` + `getAvailabilityQuality`
    // per row, so the (HYDRATE_CONCURRENCY + 1)-th `getMatchingServers` call is the
    // first row of chunk 2.
    let serverCalls = 0;
    const { ctx } = makeCtx({});
    ctx.mediaService.getMatchingServers = vi.fn().mockImplementation(() => {
      serverCalls += 1;
      if (serverCalls > HYDRATE_CONCURRENCY) {
        reachedChunkTwo();
        return new Promise(() => {}); // Never resolves — stalls chunk 2 forever.
      }
      return Promise.resolve([]);
    }) as typeof ctx.mediaService.getMatchingServers;

    // Kick off the pass but never await it: chunk 2 hangs, so it never resolves,
    // exactly as the job runner abandons a row that blows its wall-clock timeout.
    void hydrate(ctx, { staleTtlMs: 1000 });
    // Block until chunk 2's probe runs — proof chunk 1 fully persisted first.
    await chunkTwoStarted;

    // Chunk 1 finished before the stall, so its writes are durable — proving each
    // chunk persists as it resolves, not after the whole loop.
    for (let i = 0; i < HYDRATE_CONCURRENCY; i++) {
      const row = await rowById(`movie:${seedId(i)}`);
      expect(row?.hydratedAt).not.toBeNull();
    }
    // Chunk 2 never resolved, so those rows are still un-stamped and a later run
    // re-selects them.
    for (let i = HYDRATE_CONCURRENCY; i < COUNT; i++) {
      const row = await rowById(`movie:${seedId(i)}`);
      expect(row?.hydratedAt).toBeNull();
    }
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
