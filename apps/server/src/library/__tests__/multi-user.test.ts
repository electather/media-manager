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

// Membership reads/writes resolve their database handle through `getDb()`.
// Mirror the sync/lens-pages harness EXACTLY: stub `env` (the db client imports
// it transitively) and point `getDb()` at the real migrated in-memory database
// so the composite-PK conflict path is exercised against actual SQLite. The
// "same title, two owners" invariant can only be proven against the real
// `(user_id, id)` primary key the migration 0004 declares — a single global
// `id` PK would silently drop the second owner's insert under
// `onConflictDoNothing`, and only the real query planner reveals that.
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
const { allKnownKeys, upsertOwned, tombstoneMissing, __resetLibraryForTests } =
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
 * Builds the loose `MaybeLibraryContext` the public surface accepts for a given
 * user. The `catalog` handle is unused by phase-1 membership sync (carried for
 * the phase-2 hydrate path), so an empty stub cast through the resolver's
 * expected type is sufficient. Each call gets a fresh media-service stub bound
 * to `userId` so two users never share a feed.
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
  // SAME TITLE, TWO OWNERS — the core regression. `id` ("movie:550") is unique
  // only WITHIN a user, so two users owning the same title are TWO distinct rows
  // under the `(user_id, id)` primary key. Both inserts MUST report 1 inserted
  // and both per-user rows MUST be owned. If the table ever reverts to a single
  // global `id` PK, uB's insert collides on the existing `movie:550` pk; the
  // repo's `onConflictDoNothing` then silently drops it, `upsertOwned` returns 0,
  // and uB has no row — this test fails on the `expect(insertedB).toBe(1)`
  // assertion and again on uB's `owned === true`. That is the mutation-sensitive
  // heart of the fix.
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

  // PER-USER allKnownKeys ISOLATION — the diff key set is userId-scoped. uA and
  // uB each own a disjoint set plus one shared title; `allKnownKeys(uA)` must
  // return ONLY uA's keys and `allKnownKeys(uB)` ONLY uB's. If the query ever
  // dropped its `user_id` predicate, each set would leak the other user's keys
  // and a brand-new owned title for one user could be wrongly pre-filtered as
  // "already known" because the OTHER user owns it — silently never inserted.
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

  // PER-USER TOMBSTONE ISOLATION — `tombstoneMissing` is userId-scoped, so
  // tombstoning a title for uA MUST NOT touch uB's row for the same title. After
  // both own "movie:550", a tombstone sweep for uA that keeps nothing flips uA's
  // row to owned=false; uB's identically-keyed row stays owned=true. If the
  // update ever dropped its `user_id` predicate, uB's row would be collateral
  // damage — one user's un-ownership would silently erase another's library.
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

  // END-TO-END via syncMembership — two users each sync a feed that contains the
  // SAME title plus a private one. Each user must end with its own owned row for
  // the shared title and independent counts: each sync sees only its own feed
  // (its own `getCollectionFeed` stub) and inserts only its own rows. A
  // regression to a global `id` PK would surface here as uB's sync reporting
  // `added: 1` instead of `2` (the shared title's insert dropped on conflict),
  // and uB missing the shared owned row. This walks the real public lifecycle,
  // not the repo directly.
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
