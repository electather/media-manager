import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../__tests__/helpers/in-memory-db";
import { user } from "../../db/schema/auth";
import { libraryItems } from "../../db/schema/library";

// Stub `env` and point `getDb()` at the real in-memory db so keyset ORDER BY,
// COALESCE timeline predicate, and json_each filters exercise actual SQLite —
// off-by-one boundary and null/0 ORDER-BY-vs-cursor mismatch only visible to real query planner.
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
// stubbed `getDb`. The repo (lens pages) and the keyset codec are imported real
// — mocking either would defeat the very invariants these tests lock.
const { selectAzPage, selectTimelinePage } = await import("../repo");
const { __resetLibraryForTests } = await import("../repo");
const { azToken, decodeAz, timelineToken, decodeTimeline } = await import("../sources/keyset");
const { encode, decode } = await import("../../media");

let testDb: Db;

const USER_ID = "u1";

/** A row the lens sources page off, in the `library_items` insert shape. */
interface SeedRow {
  id: string;
  tmdbId?: string;
  mediaType?: "movie" | "tv";
  sortTitle?: string;
  year?: number | null;
  genres?: string[];
  servers?: { id: string; label: string }[];
  qualityTiers?: string[];
  watchedState?: "watched" | "partial" | "unwatched" | null;
  owned?: boolean;
}

/**
 * Inserts owned library rows, defaulting every field except those under test.
 * `owned` defaults true; override to seed a tombstone and verify `owned = true` filter.
 */
async function seed(rows: SeedRow[]): Promise<void> {
  await testDb.insert(libraryItems).values(
    rows.map((r) => ({
      id: r.id,
      userId: USER_ID,
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
    })),
  );
}

/**
 * Walks every A–Z page threading cursor as `sources/az.ts` does: encode nextRow via azToken,
 * wrap in `{ mode: "keyset", k }`, round-trip encode/decode, decode with decodeAz.
 * Returns ordered ids + exhausted flag. Loop cap prevents infinite/duplicate loops.
 */
async function walkAz(limit: number): Promise<{ ids: string[]; exhausted: boolean }> {
  const ids: string[] = [];
  let cursor: ReturnType<typeof decodeAz> = undefined;
  let exhausted = false;
  for (let guard = 0; guard < 1000; guard++) {
    const page = await selectAzPage(USER_ID, {}, cursor, limit);
    for (const row of page.rows) ids.push(row.id);
    if (!page.nextRow) {
      exhausted = true;
      break;
    }
    const raw = encode({ mode: "keyset", k: azToken(page.nextRow) });
    cursor = decodeAz(decode(raw));
  }
  return { ids, exhausted };
}

/** Timeline twin of {@link walkAz}, threading `timelineToken`/`decodeTimeline`. */
async function walkTimeline(limit: number): Promise<{ ids: string[]; exhausted: boolean }> {
  const ids: string[] = [];
  let cursor: ReturnType<typeof decodeTimeline> = undefined;
  let exhausted = false;
  for (let guard = 0; guard < 1000; guard++) {
    const page = await selectTimelinePage(USER_ID, {}, cursor, limit);
    for (const row of page.rows) ids.push(row.id);
    if (!page.nextRow) {
      exhausted = true;
      break;
    }
    const raw = encode({ mode: "keyset", k: timelineToken(page.nextRow) });
    cursor = decodeTimeline(decode(raw));
  }
  return { ids, exhausted };
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

describe("library lens pages (design §The 5 lenses, phase 2 keyset)", () => {
  // AZ PAGINATION COMPLETENESS invariant: threading nextRow across page boundaries
  // must reconstruct the full sorted set with no skips/duplicates. 7 rows at limit 2
  // crosses 3 boundaries (2,2,2,1); off-by-one in toLensPage encoding (dropped vs last row)
  // drops/repeats boundary id. Single-page tests cannot catch this.
  it("pages the whole A–Z set across boundaries with no skips or duplicates", async () => {
    await seed([
      { id: "movie:1", sortTitle: "Alpha" },
      { id: "movie:2", sortTitle: "Bravo" },
      { id: "movie:3", sortTitle: "Charlie" },
      { id: "movie:4", sortTitle: "Delta" },
      { id: "movie:5", sortTitle: "Echo" },
      { id: "movie:6", sortTitle: "Foxtrot" },
      { id: "movie:7", sortTitle: "Golf" },
    ]);

    const { ids, exhausted } = await walkAz(2);

    // The concatenation across every page equals the full set in `(sortTitle,
    // id)` order — exactly once each, in order. Using `toEqual` on the ordered
    // array asserts order, no-skip, and no-duplicate in one shot.
    expect(ids).toEqual([
      "movie:1",
      "movie:2",
      "movie:3",
      "movie:4",
      "movie:5",
      "movie:6",
      "movie:7",
    ]);
    // Sanity: the seeded set was fully reconstructed, none lost or doubled.
    expect(new Set(ids).size).toBe(7);
    expect(ids).toHaveLength(7);
    // The final page (a short read of 1 row) emitted no next cursor, so the
    // pipeline ends the scan rather than looping forever.
    expect(exhausted).toBe(true);
  });

  // AZ KEYSET TIEBREAK: keyset predicate is `(sortTitle, id)`. Dropping id tiebreak
  // (resuming on `sortTitle > cursor` alone) skips the second same-title row.
  // Limit 1 forces boundary after first of three same-title rows to catch loss of `movie:b`.
  it("keeps both rows of a sortTitle tie, ordered by id, across the boundary", async () => {
    await seed([
      { id: "movie:a", sortTitle: "Same" },
      { id: "movie:b", sortTitle: "Same" },
      { id: "movie:c", sortTitle: "Same" },
    ]);

    const { ids, exhausted } = await walkAz(1);

    // Both tied rows survive and stay in ascending-id order across the boundary
    // that splits the tie.
    expect(ids).toEqual(["movie:a", "movie:b", "movie:c"]);
    expect(exhausted).toBe(true);
  });

  // TIMELINE PAGINATION: order is `COALESCE(year, 0) DESC, id ASC`; null + literal-0 years
  // both tail and tie-break by id. Must reconstruct full set with no drops/duplicates.
  // ORDER BY/cursor mismatch (e.g. raw `year DESC`) at null/0 boundary skips or doubles a row.
  it("pages the Timeline set with null and year-0 at the tail, no skips or duplicates", async () => {
    await seed([
      { id: "movie:y2020", year: 2020 },
      { id: "movie:y2000", year: 2000 },
      { id: "movie:y1999", year: 1999 },
      { id: "movie:y0", year: 0 },
      { id: "movie:nullA", year: null },
      { id: "movie:nullB", year: null },
    ]);

    const { ids, exhausted } = await walkTimeline(2);

    // year DESC for the dated rows, then the COALESCE-to-0 tail (the literal-0
    // row and both nulls) ordered among themselves by ascending id. `movie:nullA`
    // < `movie:nullB` < `movie:y0` lexically, so the tail order is fixed.
    expect(ids).toEqual([
      "movie:y2020",
      "movie:y2000",
      "movie:y1999",
      "movie:nullA",
      "movie:nullB",
      "movie:y0",
    ]);
    expect(new Set(ids).size).toBe(6);
    expect(ids).toHaveLength(6);
    expect(exhausted).toBe(true);
  });

  // CURSOR CODEC — the resume tuple must survive a full encode->decode round-trip
  // for both lenses, and EVERY bad-cursor path must degrade to `undefined`
  // (read as "first page") and NEVER throw. This is the V.CU1 "a hand-edited
  // cursor degrades, never 400s" invariant.
  it("round-trips a keyset cursor and folds every bad cursor to first-page", () => {
    // A–Z round-trip: a row with a SPACE in its sortTitle proves the codec
    // splits on the LAST space, recovering the full sortTitle and the id.
    const azRow = { sortTitle: "The Matrix", id: "movie:603" } as Parameters<typeof azToken>[0];
    expect(decodeAz(decode(encode({ mode: "keyset", k: azToken(azRow) })))).toEqual({
      sortTitle: "The Matrix",
      id: "movie:603",
    });

    // Timeline round-trip: the year parses back to a finite integer and the id
    // survives; an undated row pages as year 0.
    const tlRow = { year: 1999, id: "movie:603" } as Parameters<typeof timelineToken>[0];
    expect(decodeTimeline(decode(encode({ mode: "keyset", k: timelineToken(tlRow) })))).toEqual({
      year: 1999,
      id: "movie:603",
    });
    const undated = { year: null, id: "movie:9" } as Parameters<typeof timelineToken>[0];
    expect(decodeTimeline(decode(encode({ mode: "keyset", k: timelineToken(undated) })))).toEqual({
      year: 0,
      id: "movie:9",
    });

    // A null cursor (no cursor supplied) is first-page for both lenses.
    expect(decodeAz(null)).toBeUndefined();
    expect(decodeTimeline(null)).toBeUndefined();

    // A foreign (offset) cursor is not a keyset cursor → first-page, no throw.
    const offset = decode(encode({ mode: "offset", n: 5 }));
    expect(() => decodeAz(offset)).not.toThrow();
    expect(decodeAz(offset)).toBeUndefined();
    expect(decodeTimeline(offset)).toBeUndefined();

    // An empty keyset token has no space → first-page.
    expect(decodeAz(decode(encode({ mode: "keyset", k: "" })))).toBeUndefined();
    expect(decodeTimeline(decode(encode({ mode: "keyset", k: "" })))).toBeUndefined();

    // A token with a trailing space (empty id) → first-page.
    expect(decodeAz(decode(encode({ mode: "keyset", k: "Alpha " })))).toBeUndefined();

    // A timeline token whose head is not a finite number → first-page rather
    // than flowing NaN into the keyset comparison.
    expect(
      decodeTimeline(decode(encode({ mode: "keyset", k: "notanumber movie:1" }))),
    ).toBeUndefined();

    // A malformed/garbage opaque cursor string decodes to null upstream, so
    // both lens decoders fold it to first-page and never throw.
    expect(() => decodeAz(decode("@@@not-base64-json@@@"))).not.toThrow();
    expect(decodeAz(decode("@@@not-base64-json@@@"))).toBeUndefined();
    expect(decodeTimeline(decode("@@@not-base64-json@@@"))).toBeUndefined();
  });

  // FILTERS IN SQL: each axis narrows owned set in SQL; empty axis returns everything.
  // Single seed exercises all: kinds (media_type IN), watched (watched_state IN),
  // genres/qualities (json_each value membership), servers (json_each label membership, multi-valued).
  // Tombstoned row verifies `owned = true` base filter never leaks.
  it("applies each filter axis in SQL and an empty axis returns everything", async () => {
    await seed([
      {
        id: "movie:1",
        sortTitle: "A",
        mediaType: "movie",
        watchedState: "watched",
        genres: ["Drama", "Crime"],
        qualityTiers: ["4K HDR"],
        servers: [
          { id: "plex", label: "Plex" },
          { id: "jellyfin", label: "Jellyfin" },
        ],
      },
      {
        id: "tv:2",
        sortTitle: "B",
        mediaType: "tv",
        watchedState: "unwatched",
        genres: ["Comedy"],
        qualityTiers: ["1080p"],
        servers: [{ id: "jellyfin", label: "Jellyfin" }],
      },
      {
        id: "movie:3",
        sortTitle: "C",
        mediaType: "movie",
        watchedState: "partial",
        genres: ["Drama"],
        qualityTiers: ["720p"],
        servers: [{ id: "emby", label: "Emby" }],
      },
      // A tombstoned row must NEVER surface in any lens — the base WHERE is
      // `owned = true`. Give it a kind/genre/server that would otherwise match
      // the filters below so a dropped `owned` guard would leak it.
      {
        id: "movie:dead",
        sortTitle: "D",
        mediaType: "movie",
        watchedState: "watched",
        genres: ["Drama"],
        qualityTiers: ["4K HDR"],
        servers: [{ id: "plex", label: "Plex" }],
        owned: false,
      },
    ]);

    const ids = async (filters: Parameters<typeof selectAzPage>[1]) => {
      const page = await selectAzPage(USER_ID, filters, undefined, 100);
      return page.rows.map((r) => r.id).sort();
    };

    // Empty axes → no filter: every OWNED row, never the tombstone.
    expect(await ids({})).toEqual(["movie:1", "movie:3", "tv:2"]);

    // kinds: media_type IN (...).
    expect(await ids({ kinds: ["tv"] })).toEqual(["tv:2"]);
    expect(await ids({ kinds: ["movie"] })).toEqual(["movie:1", "movie:3"]);

    // watched: watched_state IN (...).
    expect(await ids({ watched: ["watched"] })).toEqual(["movie:1"]);
    expect(await ids({ watched: ["watched", "partial"] })).toEqual(["movie:1", "movie:3"]);

    // genres: json_each value membership — `movie:1` and `movie:3` both carry
    // "Drama"; `tv:2` does not.
    expect(await ids({ genres: ["Drama"] })).toEqual(["movie:1", "movie:3"]);
    expect(await ids({ genres: ["Comedy"] })).toEqual(["tv:2"]);

    // qualities: json_each value membership.
    expect(await ids({ qualities: ["4K HDR"] })).toEqual(["movie:1"]);
    expect(await ids({ qualities: ["1080p", "720p"] })).toEqual(["movie:3", "tv:2"]);

    // servers: json_each LABEL membership over the `{ id, label }` objects (the
    // label is the facet key the popover surfaces and sends back). A multi-server
    // row (`movie:1` on Plex+Jellyfin) matches when ANY requested server label is
    // one of its servers; the connection id is NOT a match value.
    expect(await ids({ servers: ["Plex"] })).toEqual(["movie:1"]);
    expect(await ids({ servers: ["Jellyfin"] })).toEqual(["movie:1", "tv:2"]);
    expect(await ids({ servers: ["Emby"] })).toEqual(["movie:3"]);
    expect(await ids({ servers: ["plex"] })).toEqual([]);

    // Combined axes intersect (AND across axes): a movie, watched, on Plex.
    expect(await ids({ kinds: ["movie"], watched: ["watched"], servers: ["Plex"] })).toEqual([
      "movie:1",
    ]);
  });
});
