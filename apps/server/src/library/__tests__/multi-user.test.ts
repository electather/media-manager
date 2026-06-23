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

// Stub `env` and point `getDb()` at real migrated in-memory db to exercise
// composite-PK conflict against actual SQLite. A global `id` PK (migration 0004
// declares `(user_id, id)`) would silently drop the second owner's insert.
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
// stubbed `getDb`. The repo and service are imported real (NOT mocked): mocking
// either would defeat the very per-user isolation invariants these tests guard.
const { syncMembership } = await import("../service");
const { allKnownKeys, upsertOwned, tombstoneMissing, writeHydration, __resetLibraryForTests } =
  await import("../repo");
const { asLibraryContext } = await import("../internal/context");

let testDb: Db;

const log: ConsolaInstance = consola.withTag("test");

const USER_A = "uA";
const USER_B = "uB";

/** Shape the `collection@v1` aggregate surfaces, as `syncMembership` consumes it. */
type CollectionFeed = { items: unknown[]; partial: boolean };

/**
 * Builds one feed entry in the `collection@v1` `{ item, addedAt }` shape that
 * `toOwnedRow` parses. `addedAt` is an ISO string so `parseItemDate` resolves a
 * real `ownedAt`.
 */
function entry(tmdbId: string, type: "movie" | "tv" = "movie", addedAt?: string) {
  return { item: { ids: { tmdb_id: tmdbId }, type }, addedAt: addedAt ?? "2024-01-01T00:00:00Z" };
}

/**
 * A media-service stub whose only sync-relevant method is `getCollectionFeed`.
 * Each user's sync gets its own stub so the two feeds stay independent — the
 * end-to-end isolation test relies on each user seeing only its own feed.
 */
function makeMediaService(feed: CollectionFeed = { items: [], partial: false }) {
  return { getCollectionFeed: vi.fn().mockResolvedValue(feed) };
}

/**
 * Builds `MaybeLibraryContext` for a user. `catalog` is unused by phase-1 membership
 * sync (carried for phase-2 hydrate). Each call gets a fresh media-service stub
 * bound to `userId` so two users never share a feed.
 */
function makeCtx(userId: string, feed?: CollectionFeed) {
  const mediaService = makeMediaService(feed);
  const ctx = {
    userId,
    mediaService: mediaService as unknown as Parameters<typeof asLibraryContext>[0]["mediaService"],
    catalog: {} as unknown as Parameters<typeof asLibraryContext>[0]["catalog"],
    log,
  };
  return { ctx, mediaService };
}

/** Reads a single library row scoped to `userId` by its composite id, or undefined. */
async function rowById(userId: string, id: string) {
  const rows = await testDb
    .select()
    .from(libraryItems)
    .where(and(eq(libraryItems.userId, userId), eq(libraryItems.id, id)));
  return rows[0];
}

/** Inserts a seed `user` row so the `library_items.user_id` foreign key resolves. */
async function seedUser(id: string) {
  await testDb.insert(user).values({
    id,
    name: id,
    email: `${id}@test`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

beforeAll(async () => {
  testDb = await createInMemoryDb();
  // Seed TWO users. Both can legitimately own the SAME title; the composite PK
  // is what keeps each owner's row distinct, and that is exactly what these
  // tests lock.
  await seedUser(USER_A);
  await seedUser(USER_B);
});

afterAll(() => cleanupInMemoryDbs());

beforeEach(async () => {
  await __resetLibraryForTests(testDb);
});

describe("library multi-user membership (design §Sync + hydrate, composite-PK isolation)", () => {
  // Core regression: `(user_id, id)` composite PK keeps two users' identical titles
  // as distinct rows. A global `id` PK would drop uB's insert via `onConflictDoNothing`.
  it("lets two users each own the same title as distinct rows", async () => {
    const insertedA = await upsertOwned(
      [{ id: "movie:550", userId: USER_A, tmdbId: "550", mediaType: "movie", ownedAt: Date.now() }],
      testDb,
    );
    const insertedB = await upsertOwned(
      [{ id: "movie:550", userId: USER_B, tmdbId: "550", mediaType: "movie", ownedAt: Date.now() }],
      testDb,
    );

    // Each user's insert lands its own row — a global `id` PK would drop uB's.
    expect(insertedA).toBe(1);
    expect(insertedB).toBe(1);

    // Both per-user rows exist and are owned; the ids match but the rows are
    // distinct because they are scoped by `user_id`.
    const aRow = await rowById(USER_A, "movie:550");
    const bRow = await rowById(USER_B, "movie:550");
    expect(aRow?.owned).toBe(true);
    expect(bRow?.owned).toBe(true);
    expect(aRow?.userId).toBe(USER_A);
    expect(bRow?.userId).toBe(USER_B);

    // Exactly two rows carry that composite id across the whole table — one per
    // owner, never collapsed into one.
    const allWithId = await testDb
      .select()
      .from(libraryItems)
      .where(eq(libraryItems.id, "movie:550"));
    expect(allWithId).toHaveLength(2);
  });

  // `allKnownKeys` is userId-scoped. Dropping the `user_id` predicate would leak
  // the other user's keys, wrongly pre-filtering a new title as "already known".
  it("scopes allKnownKeys to a single user", async () => {
    await upsertOwned(
      [
        { id: "movie:550", userId: USER_A, tmdbId: "550", mediaType: "movie", ownedAt: Date.now() },
        { id: "tv:1400", userId: USER_A, tmdbId: "1400", mediaType: "tv", ownedAt: Date.now() },
      ],
      testDb,
    );
    await upsertOwned(
      [
        // uB shares "movie:550" with uA and adds a title uA does NOT own.
        { id: "movie:550", userId: USER_B, tmdbId: "550", mediaType: "movie", ownedAt: Date.now() },
        { id: "movie:603", userId: USER_B, tmdbId: "603", mediaType: "movie", ownedAt: Date.now() },
      ],
      testDb,
    );

    // Each set is exactly that user's keys — never the other's.
    expect(await allKnownKeys(USER_A)).toEqual(new Set(["movie:550", "tv:1400"]));
    expect(await allKnownKeys(USER_B)).toEqual(new Set(["movie:550", "movie:603"]));
  });

  // `tombstoneMissing` is userId-scoped. Dropping the `user_id` predicate would
  // collateral-damage the other user's row — one user's un-ownership erasing another's.
  it("tombstones a title for one user without touching the other owner", async () => {
    await upsertOwned(
      [{ id: "movie:550", userId: USER_A, tmdbId: "550", mediaType: "movie", ownedAt: Date.now() }],
      testDb,
    );
    await upsertOwned(
      [{ id: "movie:550", userId: USER_B, tmdbId: "550", mediaType: "movie", ownedAt: Date.now() }],
      testDb,
    );

    // Sweep uA with an empty keep set — every owned row for uA is tombstoned.
    const tombstoned = await tombstoneMissing(USER_A, [], Date.now(), testDb);
    expect(tombstoned).toBe(1);

    // uA's row is now tombstoned; uB's identically-keyed row is untouched.
    const aRow = await rowById(USER_A, "movie:550");
    expect(aRow?.owned).toBe(false);
    expect(aRow?.unownedAt).not.toBeNull();

    const bRow = await rowById(USER_B, "movie:550");
    expect(bRow?.owned).toBe(true);
    expect(bRow?.unownedAt).toBeNull();
  });

  // `writeHydration` is userId-scoped. Projection mixes global (sortTitle, year)
  // with per-user (`watchedState`, `servers`, `qualityTiers`). Leaking across
  // users corrupts uB's continue-watching and stamps `hydratedAt`, suppressing self-heal.
  it("hydrates a title for one user without touching the other owner's row", async () => {
    await upsertOwned(
      [{ id: "movie:550", userId: USER_A, tmdbId: "550", mediaType: "movie", ownedAt: Date.now() }],
      testDb,
    );
    await upsertOwned(
      [{ id: "movie:550", userId: USER_B, tmdbId: "550", mediaType: "movie", ownedAt: Date.now() }],
      testDb,
    );

    // Hydrate the shared title for uA only, with uA's per-user projection.
    const written = await writeHydration(
      USER_A,
      [
        {
          id: "movie:550",
          sortTitle: "matrix",
          year: 1999,
          genres: ["Action"],
          servers: [{ id: "plex-a", label: "uA's Plex" }],
          qualityTiers: ["4K HDR"],
          watchedState: "partial",
          collectionId: null,
          collectionName: null,
        },
      ],
      Date.now(),
      testDb,
    );
    // One update processed. The count is per-update, not per-row, so the real
    // isolation proof is the uB assertions below — not this number.
    expect(written).toBe(1);

    // uA's row carries the projection and is stamped hydrated.
    const aRow = await rowById(USER_A, "movie:550");
    expect(aRow?.watchedState).toBe("partial");
    expect(aRow?.servers).toEqual([{ id: "plex-a", label: "uA's Plex" }]);
    expect(aRow?.hydratedAt).not.toBeNull();

    // uB's identically-keyed row is untouched: no leaked per-user projection
    // and no stamped `hydratedAt`, so uB's own hydrate still sees it as new.
    const bRow = await rowById(USER_B, "movie:550");
    expect(bRow?.watchedState).toBeNull();
    expect(bRow?.servers).toEqual([]);
    expect(bRow?.qualityTiers).toEqual([]);
    expect(bRow?.hydratedAt).toBeNull();
  });

  // End-to-end via syncMembership: each user syncs its own feed with shared title.
  // A global `id` PK would drop uB's shared-title insert, reporting `added: 1` not `2`.
  it("syncs each user's feed independently when feeds share a title", async () => {
    // uA owns the shared title plus a private one.
    const resultA = await syncMembership(
      makeCtx(USER_A, {
        items: [entry("550"), entry("700")],
        partial: false,
      }).ctx,
    );
    expect(resultA).toEqual({ added: 2, partial: false, removed: 0 });

    // uB's feed re-includes the SAME shared title plus a different private one.
    // Both rows are new FOR uB, so its sync inserts two even though uA already
    // owns "movie:550".
    const resultB = await syncMembership(
      makeCtx(USER_B, {
        items: [entry("550"), entry("800")],
        partial: false,
      }).ctx,
    );
    expect(resultB).toEqual({ added: 2, partial: false, removed: 0 });

    // Each user's known-key projection is exactly its own feed — never blended.
    expect(await allKnownKeys(USER_A)).toEqual(new Set(["movie:550", "movie:700"]));
    expect(await allKnownKeys(USER_B)).toEqual(new Set(["movie:550", "movie:800"]));

    // Both own the shared title as their own owned row; neither sees the other's
    // private title.
    expect((await rowById(USER_A, "movie:550"))?.owned).toBe(true);
    expect((await rowById(USER_B, "movie:550"))?.owned).toBe(true);
    expect(await rowById(USER_A, "movie:800")).toBeUndefined();
    expect(await rowById(USER_B, "movie:700")).toBeUndefined();
  });
});
