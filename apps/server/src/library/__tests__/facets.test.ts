import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../__tests__/helpers/in-memory-db";
import { user } from "../../db/schema/auth";
import { libraryItems } from "../../db/schema/library";

// `selectFacets` resolves its database handle through `getDb()`. Point it at the
// real migrated in-memory database (which applies every drizzle migration,
// including `library_items`) so each aggregation runs against actual SQLite. The
// dedup invariant (test 3) can only be proven against the real `json_each`
// expansion and `count(DISTINCT id)` semantics — a mocked repo would let a
// `count(*)` regression slip through unnoticed.
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
 * The fields a denormalized library row needs to land in a facet bucket. Every
 * column `selectFacets` reads is overridable; the rest fall back to a sensible
 * owned-row default. Seeding `libraryItems` directly (rather than through
 * `upsertOwned` + `writeHydration`) is deliberate: `upsertOwned` leaves the
 * facet columns at their schema defaults, so a direct insert is the only way to
 * drive `genres`/`servers`/`qualityTiers`/`watchedState`/`sortTitle`/`year`
 * across the exact shapes each invariant needs.
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
  // SINGLE-VALUED GROUP BY — `kinds` and `watched` are one bucket per row,
  // counted with `count(*)` over the owned set. A `tv` row and two `movie` rows
  // yield `{ movie: 2, tv: 1 }`; the watched buckets count one each per state.
  // CRUCIALLY a row with a null `watchedState` must be DROPPED from the watched
  // map (`rowsToMap` skips the null bucket) rather than surfacing as a phantom
  // key — if the null filter regressed, `watched` would carry an extra entry and
  // the strict `toEqual` below would fail.
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

  // MULTI-VALUED json_each — `servers`, `genres`, and `qualities` expand each row
  // through `json_each`, so a SINGLE title present on two servers contributes one
  // count to EACH server bucket (a title count per value, not a row count). The
  // same holds for two distinct genres and two distinct quality tiers on one row.
  // If the `json_each` cross-join regressed to a plain column read, only the
  // first array element would surface and the second bucket would be absent.
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

  // DEDUP — locks the `count(DISTINCT id)` fix. A single owned row whose `genres`
  // JSON repeats a value (dirty plugin metadata returning `["Drama","Drama"]`)
  // must count that genre EXACTLY ONCE: a facet is a title count, not an
  // array-element count. `json_each` emits one expanded row per array element, so
  // under `count(*)` this would tally `Drama: 2` from a single title. This test
  // is the mutation-sensitive heart of the dedup guard — it FAILS the moment the
  // aggregation reverts to `count(*)`.
  it("counts a repeated genre on one title exactly once (count(DISTINCT id))", async () => {
    await seed({ id: "movie:20", tmdbId: "20", genres: ["Drama", "Drama"] });

    const facets = await selectFacets(USER_ID);

    expect(facets.genres).toEqual({ Drama: 1 });
  });

  // OWNED-ONLY — every aggregation is scoped to `owned = true`, so a tombstoned
  // row (`owned = false`) must contribute to NO facet bucket: not `kinds`, not
  // the multi-valued axes, not `letters`, not `decades`. If the owned predicate
  // were dropped, the tombstone's media type, genre, server, leading letter, and
  // decade would all leak into the maps and rails — every assertion below would
  // fail. We pair the tombstone with one live owned row so the maps are non-empty
  // and prove the tombstone is the only thing excluded.
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

  // LETTERS present-only — the A→Z rail lists the DISTINCT uppercased first
  // characters of `sortTitle` that have at least one owned title. A leading
  // non-alphabetic character (a digit, a symbol) or a blank `sortTitle` folds to
  // the catch-all `"#"`, and `"#"` must sort LAST so it trails the letters. A
  // letter with no owned title is absent (present-only). This pins the fold, the
  // distinct-uppercase collapse, and the `"#"`-trails-letters sort all at once.
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

  // DECADES present-only, newest first — the timeline rail lists the DISTINCT
  // decades (`floor(year / 10) * 10`) that have an owned title, sorted DESC so
  // the newest decade leads. A row with a null `year` contributes NO decade
  // (it is excluded by the `year IS NOT NULL` predicate). Two titles in the same
  // decade collapse to one entry. This fails if the sort direction flips, if the
  // decade arithmetic regresses, or if null-year rows leak a phantom decade.
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
