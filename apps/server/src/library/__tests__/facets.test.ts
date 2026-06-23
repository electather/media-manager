import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../__tests__/helpers/in-memory-db";
import { user } from "../../db/schema/auth";
import { libraryItems } from "../../db/schema/library";

// Uses real DB (not mocked) so aggregations run against actual SQLite. Only the
// real `json_each` and `count(DISTINCT id)` semantics can prove dedup (test 3);
// a mocked repo would let `count(*)` regressions slip unnoticed.
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
// stubbed `getDb`. The repo is imported real (NOT mocked): the SQL each
// aggregation emits is precisely what these tests exist to pin.
const { selectFacets } = await import("../repo");
const { __resetLibraryForTests } = await import("../repo");

let testDb: Db;

const USER_ID = "u1";

/**
 * Fields needed for a denormalized row to land in a facet bucket. Direct insert
 * (not `upsertOwned` + `writeHydration`) because `upsertOwned` leaves facet
 * columns at schema defaults — only a direct insert drives `genres`/`servers`/
 * `qualityTiers`/`watchedState`/`sortTitle`/`year` across the exact shapes
 * each invariant needs.
 */
interface SeedRow {
  id: string;
  tmdbId: string;
  mediaType?: "movie" | "tv";
  owned?: boolean;
  sortTitle?: string;
  year?: number | null;
  genres?: string[];
  servers?: { id: string; label: string }[];
  qualityTiers?: string[];
  watchedState?: "watched" | "partial" | "unwatched" | null;
}

/** Inserts one fully-specified owned (or tombstoned) library row for `USER_ID`. */
async function seed(row: SeedRow): Promise<void> {
  await testDb.insert(libraryItems).values({
    id: row.id,
    userId: USER_ID,
    tmdbId: row.tmdbId,
    mediaType: row.mediaType ?? "movie",
    owned: row.owned ?? true,
    ownedAt: Date.now(),
    sortTitle: row.sortTitle ?? "",
    year: row.year ?? null,
    genres: row.genres ?? [],
    servers: row.servers ?? [],
    qualityTiers: row.qualityTiers ?? [],
    watchedState: row.watchedState ?? null,
  });
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

describe("library facets (design §Facets)", () => {
  // SINGLE-VALUED GROUP BY — `kinds`/`watched` count one per row with `count(*)`.
  // CRUCIALLY: null `watchedState` must be DROPPED (not phantom key) — if the
  // null filter regressed, `watched` would have an extra entry and `toEqual` fail.
  it("counts single-valued kinds and watched, dropping the null watched bucket", async () => {
    await seed({ id: "movie:1", tmdbId: "1", mediaType: "movie", watchedState: "watched" });
    await seed({ id: "movie:2", tmdbId: "2", mediaType: "movie", watchedState: "partial" });
    await seed({ id: "tv:3", tmdbId: "3", mediaType: "tv", watchedState: "unwatched" });
    // A fourth owned row with NO watched state: it counts toward `kinds` but must
    // contribute no entry to `watched` (the null bucket is dropped).
    await seed({ id: "movie:4", tmdbId: "4", mediaType: "movie", watchedState: null });

    const facets = await selectFacets(USER_ID);

    expect(facets.kinds).toEqual({ movie: 3, tv: 1 });
    expect(facets.watched).toEqual({ watched: 1, partial: 1, unwatched: 1 });
  });

  // MULTI-VALUED json_each — `servers`/`genres`/`qualities` expand via `json_each`:
  // one title on two servers counts per bucket (title count per value, not row count).
  // If `json_each` regressed to plain column read, only first element would surface.
  it("expands multi-valued servers, genres and qualities so one title hits every bucket", async () => {
    await seed({
      id: "movie:10",
      tmdbId: "10",
      servers: [
        { id: "s1", label: "Plex" },
        { id: "s2", label: "Jellyfin" },
      ],
      genres: ["Drama", "Comedy"],
      qualityTiers: ["4K", "1080p"],
    });

    const facets = await selectFacets(USER_ID);

    // The one title lands in both server buckets, both genre buckets, and both
    // quality buckets — each as a single title count.
    expect(facets.servers).toEqual({ Plex: 1, Jellyfin: 1 });
    expect(facets.genres).toEqual({ Drama: 1, Comedy: 1 });
    expect(facets.qualities).toEqual({ "4K": 1, "1080p": 1 });
  });

  // DEDUP — `count(DISTINCT id)` ensures repeated genres (dirty metadata like
  // `["Drama","Drama"]`) count ONCE per title, not per array element. If
  // aggregation regresses to `count(*)`, this test FAILS — mutation-sensitive guard.
  it("counts a repeated genre on one title exactly once (count(DISTINCT id))", async () => {
    await seed({ id: "movie:20", tmdbId: "20", genres: ["Drama", "Drama"] });

    const facets = await selectFacets(USER_ID);

    expect(facets.genres).toEqual({ Drama: 1 });
  });

  // OWNED-ONLY — aggregations scoped to `owned = true`, so tombstones contribute
  // to no bucket. If the owned predicate dropped, tombstone values would leak into
  // all facets. Pairs tombstone + live row so non-empty maps prove tombstone alone
  // is excluded.
  it("excludes tombstoned (owned=false) rows from every facet, letter and decade", async () => {
    // Live owned anchor: contributes a movie, a genre, a server, letter A, 2020s.
    await seed({
      id: "movie:30",
      tmdbId: "30",
      mediaType: "movie",
      sortTitle: "Arrival",
      year: 2016,
      genres: ["Drama"],
      servers: [{ id: "s1", label: "Plex" }],
      qualityTiers: ["1080p"],
      watchedState: "watched",
    });
    // Tombstoned row with entirely DIFFERENT facet values: if any leaked, it
    // would be visible (a `tv` kind, a `Horror` genre, a `Jellyfin` server,
    // letter Z, the 1990s decade).
    await seed({
      id: "tv:31",
      tmdbId: "31",
      mediaType: "tv",
      owned: false,
      sortTitle: "Zodiac",
      year: 1999,
      genres: ["Horror"],
      servers: [{ id: "s2", label: "Jellyfin" }],
      qualityTiers: ["4K"],
      watchedState: "unwatched",
    });

    const facets = await selectFacets(USER_ID);

    // Only the live owned anchor is represented anywhere.
    expect(facets.kinds).toEqual({ movie: 1 });
    expect(facets.genres).toEqual({ Drama: 1 });
    expect(facets.servers).toEqual({ Plex: 1 });
    expect(facets.qualities).toEqual({ "1080p": 1 });
    expect(facets.watched).toEqual({ watched: 1 });
    expect(facets.letters).toEqual(["A"]);
    expect(facets.decades).toEqual([2010]);
  });

  // LETTERS present-only — A→Z rail lists distinct uppercased first chars of owned
  // titles. Non-alpha (digit/symbol) or blank folds to `"#"`, which sorts LAST.
  // Pins the fold, distinct-uppercase collapse, and `"#"`-trailing sort.
  it("lists distinct uppercased leading letters, folding non-alpha to a trailing '#'", async () => {
    await seed({ id: "movie:40", tmdbId: "40", sortTitle: "alpha" }); // A
    await seed({ id: "movie:41", tmdbId: "41", sortTitle: "Avengers" }); // also A — collapses
    await seed({ id: "movie:42", tmdbId: "42", sortTitle: "Batman" }); // B
    await seed({ id: "movie:43", tmdbId: "43", sortTitle: "300" }); // digit -> #
    await seed({ id: "movie:44", tmdbId: "44", sortTitle: "" }); // blank -> #

    const facets = await selectFacets(USER_ID);

    // Distinct (A appears once despite two titles), uppercased, "#" trailing.
    // C is absent because no owned title starts with C (present-only).
    expect(facets.letters).toEqual(["A", "B", "#"]);
  });

  // DECADES present-only, newest first — timeline rail lists distinct decades
  // (`floor(year / 10) * 10`) for owned titles, sorted DESC. Null `year` excluded
  // by `year IS NOT NULL` predicate. Fails if sort direction flips, decade math
  // regresses, or null-year rows leak phantom decade.
  it("lists distinct decades newest-first, dropping null-year rows", async () => {
    await seed({ id: "movie:50", tmdbId: "50", year: 2021 }); // 2020s
    await seed({ id: "movie:51", tmdbId: "51", year: 2024 }); // also 2020s — collapses
    await seed({ id: "movie:52", tmdbId: "52", year: 2015 }); // 2010s
    await seed({ id: "movie:53", tmdbId: "53", year: 1998 }); // 1990s
    await seed({ id: "movie:54", tmdbId: "54", year: null }); // no decade

    const facets = await selectFacets(USER_ID);

    expect(facets.decades).toEqual([2020, 2010, 1990]);
  });
});
