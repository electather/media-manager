import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../__tests__/helpers/in-memory-db";
import { user } from "../../db/schema/auth";
import { libraryItems } from "../../db/schema/library";

// The collections repo resolves its database handle through `getDb()`. Mirror
// the lens-page and sync test harness EXACTLY: stub `env` (the db client imports
// it transitively) and point `getDb()` at the real migrated in-memory database
// so the group-first GROUP BY, the `COALESCE(collection_name, collection_id)`
// keyset ORDER BY, the filter-aware preview subquery, and the tenancy-scoped
// `selectRowsByIds` read are exercised against actual SQLite. The null-name
// keyset drop and the preview filter-leak can only be proven against the real
// query planner, never a mocked repo.
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
// stubbed `getDb`. The repo and the cursor codec are imported real — mocking
// either would defeat the very invariants these tests lock.
const { selectCollections, selectRowsByIds, __resetLibraryForTests } = await import("../repo");
const { encodeCollectionsCursor, decodeCollectionsCursor } =
  await import("../internal/collections-cursor");

let testDb: Db;

const USER_A = "u1";
const USER_B = "u2";

/** A row the collections lens groups off, in the `library_items` insert shape. */
interface SeedRow {
  id: string;
  userId?: string;
  tmdbId?: string;
  mediaType?: "movie" | "tv";
  sortTitle?: string;
  year?: number | null;
  genres?: string[];
  servers?: { id: string; label: string }[];
  qualityTiers?: string[];
  watchedState?: "watched" | "partial" | "unwatched" | null;
  collectionId?: string | null;
  collectionName?: string | null;
  owned?: boolean;
}

/**
 * Inserts library rows directly into `library_items`, filling every not-null
 * column with a defaultable value so a test only sets the axis it asserts on.
 * The denormalized franchise columns (`collection_id`/`collection_name`),
 * `sort_title`, `genres`, etc. are set explicitly so the grouping SQL and the
 * preview subquery have real data to page off. `owned` defaults to true so rows
 * land in the lens base set; a test overrides it to seed a tombstone. `userId`
 * defaults to USER_A so the tenancy test can plant a colliding USER_B row.
 */
async function seed(rows: SeedRow[]): Promise<void> {
  await testDb.insert(libraryItems).values(
    rows.map((r) => ({
      id: r.id,
      userId: r.userId ?? USER_A,
      tmdbId: r.tmdbId ?? r.id,
      mediaType: r.mediaType ?? ("movie" as const),
      owned: r.owned ?? true,
      ownedAt: Date.now(),
      sortTitle: r.sortTitle ?? "",
      year: r.year === undefined ? null : r.year,
      genres: r.genres ?? [],
      servers: r.servers ?? [],
      qualityTiers: r.qualityTiers ?? [],
      watchedState: r.watchedState ?? null,
      collectionId: r.collectionId === undefined ? null : r.collectionId,
      collectionName: r.collectionName === undefined ? null : r.collectionName,
    })),
  );
}

/**
 * Walks every Collections page from the first, threading the next cursor EXACTLY
 * as `service.listCollections` does: a full page's `nextGroup` is encoded with
 * `encodeCollectionsCursor`, then decoded back to a `CollectionCursor` with
 * `decodeCollectionsCursor` before the next read. Returns the ordered list of
 * collection ids the loop emitted. A safety cap turns an accidental
 * infinite/duplicating loop into a failure rather than a hang.
 */
async function walkCollections(
  userId: string,
  limit: number,
): Promise<{ collectionIds: string[]; exhausted: boolean }> {
  const collectionIds: string[] = [];
  let cursor: ReturnType<typeof decodeCollectionsCursor> = undefined;
  let exhausted = false;
  for (let guard = 0; guard < 1000; guard++) {
    const page = await selectCollections(userId, {}, cursor, limit);
    for (const group of page.groups) collectionIds.push(group.collectionId);
    if (!page.nextGroup) {
      exhausted = true;
      break;
    }
    cursor = decodeCollectionsCursor(encodeCollectionsCursor(page.nextGroup));
  }
  return { collectionIds, exhausted };
}

beforeAll(async () => {
  testDb = await createInMemoryDb();
  await testDb.insert(user).values([
    {
      id: USER_A,
      name: USER_A,
      email: `${USER_A}@test`,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: USER_B,
      name: USER_B,
      email: `${USER_B}@test`,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]);
});

afterAll(() => cleanupInMemoryDbs());

beforeEach(async () => {
  await __resetLibraryForTests(testDb);
});

describe("library collections lens (design §Collections lens, phase 3)", () => {
  // OWNED-ONLY / TV-EXCLUDED — the base WHERE is `owned = true` AND
  // `collection_id IS NOT NULL`. Only the owned movie WITH a collection id is a
  // franchise; the TV row (null collection_id), the standalone movie (null
  // collection_id), and the tombstoned movie (owned = false) must NEVER surface,
  // and the tombstone must NOT inflate the franchise count. Seeding the
  // tombstone in the SAME franchise as the owned movie is the mutation-sensitive
  // part: a dropped `owned = true` guard would both surface a second group AND
  // bump this group's count to 2.
  it("returns only owned movies in a franchise, excluding TV, standalone, and tombstones", async () => {
    await seed([
      { id: "movie:1", sortTitle: "A", collectionId: "10", collectionName: "Franchise" },
      // A TV row in a (nominal) collection: TV carries a null collection_id by
      // construction, so it is never grouped.
      { id: "tv:2", mediaType: "tv", sortTitle: "B", collectionId: null },
      // A standalone movie: no franchise, null collection_id, never grouped.
      { id: "movie:3", sortTitle: "C", collectionId: null },
      // A tombstoned movie in the SAME franchise (id "10"): owned = false, so it
      // is excluded from the group and must not inflate the count to 2.
      {
        id: "movie:4",
        sortTitle: "D",
        collectionId: "10",
        collectionName: "Franchise",
        owned: false,
      },
    ]);

    const page = await selectCollections(USER_A, {}, undefined, 50);

    // Exactly one franchise, the owned-movie one; no TV/standalone/tombstone
    // group leaked.
    expect(page.groups).toHaveLength(1);
    const [group] = page.groups;
    expect(group?.collectionId).toBe("10");
    expect(group?.collectionName).toBe("Franchise");
    // The count excludes the tombstone: only `movie:1` is owned in franchise 10.
    expect(group?.count).toBe(1);
    expect(group?.previewIds).toEqual(["movie:1"]);
    // A single short-read page exhausts the scan.
    expect(page.nextGroup).toBeUndefined();
  });

  // PREVIEW <=4 ORDERED — a franchise with six owned titles caps the preview at
  // four (design §Collections lens: "preview ≤4"), ordered by `(sortTitle, id)`
  // ascending. The count still reflects all six. Seeding sort titles out of
  // insertion order proves the SQL ORDER BY (not insertion order) drives the
  // preview, and the cap proves the `LIMIT 4` in the preview subquery.
  it("caps the preview at four ids ordered by (sortTitle, id) while counting all", async () => {
    await seed([
      { id: "movie:f6", sortTitle: "Foxtrot", collectionId: "10", collectionName: "Franchise" },
      { id: "movie:f1", sortTitle: "Alpha", collectionId: "10", collectionName: "Franchise" },
      { id: "movie:f4", sortTitle: "Delta", collectionId: "10", collectionName: "Franchise" },
      { id: "movie:f2", sortTitle: "Bravo", collectionId: "10", collectionName: "Franchise" },
      { id: "movie:f5", sortTitle: "Echo", collectionId: "10", collectionName: "Franchise" },
      { id: "movie:f3", sortTitle: "Charlie", collectionId: "10", collectionName: "Franchise" },
    ]);

    const page = await selectCollections(USER_A, {}, undefined, 50);

    const [group] = page.groups;
    // The count is the full owned set, even though the preview is capped.
    expect(group?.count).toBe(6);
    // Exactly the first four in `(sortTitle, id)` order — never the later two.
    expect(group?.previewIds).toEqual(["movie:f1", "movie:f2", "movie:f3", "movie:f4"]);
    expect(group?.previewIds).toHaveLength(4);
  });

  // PREVIEW FILTER-AWARE — regression for the preview filter-leak fix. When a
  // filter is active, BOTH the group count AND the preview ids must reflect only
  // the matching titles: the preview subquery re-applies the same axis as the
  // group count. The franchise carries three "Horror" titles and two "Comedy"
  // titles; under `genres: ["Horror"]` the count is 3 and the preview lists ONLY
  // the three Horror ids — no Comedy id may leak into the fan. Before the fix the
  // count was filter-aware but the preview was not, so a Comedy id would appear;
  // asserting the exact preview set (and that no Comedy id is present) fails on
  // any leak.
  it("applies the active filter to BOTH the count and the preview ids (no leak)", async () => {
    await seed([
      {
        id: "movie:h1",
        sortTitle: "Aaa",
        collectionId: "10",
        collectionName: "Franchise",
        genres: ["Horror"],
      },
      {
        id: "movie:c1",
        sortTitle: "Bbb",
        collectionId: "10",
        collectionName: "Franchise",
        genres: ["Comedy"],
      },
      {
        id: "movie:h2",
        sortTitle: "Ccc",
        collectionId: "10",
        collectionName: "Franchise",
        genres: ["Horror"],
      },
      {
        id: "movie:c2",
        sortTitle: "Ddd",
        collectionId: "10",
        collectionName: "Franchise",
        genres: ["Comedy"],
      },
      {
        id: "movie:h3",
        sortTitle: "Eee",
        collectionId: "10",
        collectionName: "Franchise",
        genres: ["Horror"],
      },
    ]);

    const page = await selectCollections(USER_A, { genres: ["Horror"] }, undefined, 50);

    const [group] = page.groups;
    // The count narrows to the three Horror titles.
    expect(group?.count).toBe(3);
    // The preview lists ONLY the Horror ids, ordered by `(sortTitle, id)` — no
    // Comedy id leaks into the fan.
    expect(group?.previewIds).toEqual(["movie:h1", "movie:h2", "movie:h3"]);
    expect(group?.previewIds).not.toContain("movie:c1");
    expect(group?.previewIds).not.toContain("movie:c2");
  });

  // NULL-NAME KEYSET — regression for the paging blocker. Franchises whose
  // `collection_name` is NULL (only `collection_id` set: "20", "30", "40") must
  // still page completely: the ORDER BY and the cursor predicate both compare
  // `COALESCE(collection_name, collection_id)`, so the resume position is total
  // even with no learned title. Paging the whole set in `limit = 1` hops,
  // threading each page's `nextGroup` through encode/decode EXACTLY as
  // `listCollections` does, must reconstruct EVERY franchise with NO drop and NO
  // duplicate. If either side stopped using COALESCE (comparing the raw nullable
  // name), the null-name groups would compare as NULL — never strictly-greater —
  // and the cursor predicate would skip them at the very first boundary, so this
  // loop would lose them.
  it("pages every null-name franchise across boundaries with no drop or duplicate", async () => {
    await seed([
      // One named franchise plus three null-name ones. Distinct sort titles so
      // each id lands in its own group with one owned member.
      { id: "movie:n1", sortTitle: "A", collectionId: "named", collectionName: "Zeta Saga" },
      { id: "movie:n2", sortTitle: "B", collectionId: "20", collectionName: null },
      { id: "movie:n3", sortTitle: "C", collectionId: "30", collectionName: null },
      { id: "movie:n4", sortTitle: "D", collectionId: "40", collectionName: null },
    ]);

    const { collectionIds, exhausted } = await walkCollections(USER_A, 1);

    // Every franchise surfaced exactly once across the one-at-a-time pages.
    expect(new Set(collectionIds).size).toBe(4);
    expect(collectionIds).toHaveLength(4);
    expect([...collectionIds].sort()).toEqual(["20", "30", "40", "named"]);
    // The paging order follows `COALESCE(name, id)` ascending: the null-name
    // groups order by their id ("20" < "30" < "40"), then "Zeta Saga" sorts last.
    expect(collectionIds).toEqual(["20", "30", "40", "named"]);
    // The final short-read page emitted no next cursor, so the scan terminates.
    expect(exhausted).toBe(true);
  });

  // TENANCY — regression for the `selectRowsByIds` cross-tenant scope. The
  // composite id is unique only WITHIN a user, so the SAME id can exist for two
  // users. `selectRowsByIds(userA, [...])` must return ONLY userA's owned rows
  // even when userB owns a row with the same composite id (same franchise).
  // Passing both ids — including the colliding one userB owns — must NOT leak
  // userB's row. Without the `user_id = userA` scope the `id IN (…)` read would
  // surface both rows and cross tenants.
  it("scopes selectRowsByIds to the requesting user, never leaking another tenant's row", async () => {
    await seed([
      // userA owns "movie:1" (their copy) plus a distinct "movie:5".
      {
        id: "movie:1",
        userId: USER_A,
        sortTitle: "A-owned",
        collectionId: "10",
        collectionName: "Franchise",
      },
      { id: "movie:5", userId: USER_A, sortTitle: "A-extra", collectionId: "10" },
      // userB owns a row with the IDENTICAL composite id "movie:1" in the same
      // franchise — a different tenant's copy that must never leak.
      {
        id: "movie:1",
        userId: USER_B,
        sortTitle: "B-owned",
        collectionId: "10",
        collectionName: "Franchise",
      },
    ]);

    // Ask for userA's rows, passing an id userB also has.
    const rows = await selectRowsByIds(USER_A, ["movie:1", "movie:5"]);

    // Both of userA's rows come back; userB's colliding "movie:1" does not.
    expect(rows.map((r) => r.id).sort()).toEqual(["movie:1", "movie:5"]);
    // The "movie:1" we got is userA's copy (its sort title), proving no
    // cross-tenant substitution and no duplicate composite id.
    const movie1 = rows.filter((r) => r.id === "movie:1");
    expect(movie1).toHaveLength(1);
    expect(movie1[0]?.sortTitle).toBe("A-owned");
  });

  // CURSOR CODEC — the resume tuple must survive a full encode->decode round-trip
  // (including a collection name with spaces, split on the LAST space so the id
  // suffix is recovered intact), and every bad token must degrade to `undefined`
  // (read as "first page") and NEVER throw — the degrade-don't-400 discipline the
  // lens codecs follow.
  it("round-trips a collections cursor and folds every bad token to first-page", () => {
    // A name WITH spaces proves the codec splits on the LAST space: the prefix is
    // the full multi-word name, the suffix is the numeric collection id.
    const cursor = { collectionName: "The Lord of the Rings Collection", collectionId: "119" };
    expect(decodeCollectionsCursor(encodeCollectionsCursor(cursor))).toEqual(cursor);

    // A null-name group encodes its `collection_id` as the name (the service uses
    // `collection_name ?? collection_id`), so a space-free single-token name with
    // an id round-trips too.
    const fallback = { collectionName: "40", collectionId: "40" };
    expect(decodeCollectionsCursor(encodeCollectionsCursor(fallback))).toEqual(fallback);

    // An undefined token (no cursor supplied) is first-page.
    expect(decodeCollectionsCursor(undefined)).toBeUndefined();
    // An empty string is first-page, never a throw.
    expect(() => decodeCollectionsCursor("")).not.toThrow();
    expect(decodeCollectionsCursor("")).toBeUndefined();
    // A token with no space cannot carry both halves → first-page.
    expect(decodeCollectionsCursor("noSpaceToken")).toBeUndefined();
    // A trailing space yields an empty id → first-page rather than a blank-id
    // keyset that would page from the start of the tie.
    expect(decodeCollectionsCursor("Some Name ")).toBeUndefined();
  });
});
