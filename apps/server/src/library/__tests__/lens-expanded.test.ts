import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { QUALITY_TIERS } from "@nama/shared/library";
import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../__tests__/helpers/in-memory-db";
import { user } from "../../db/schema/auth";
import { libraryItems } from "../../db/schema/library";

// The grouped lens repos resolve their database handle through `getDb()`. Mirror
// the `lens-pages.test.ts` / `sync.test.ts` harness EXACTLY: stub `env` (the db
// client imports it transitively) and point `getDb()` at the real migrated
// in-memory database. The `json_each` expansion, the `sv.value ->> 'id'` /
// `qt.value` keyset ORDER BY, and the quality rank `CASE` can only be proven
// against the real SQLite query planner — the expanded off-by-one boundary and
// the rank-vs-cursor mismatch never reproduce against a mocked repo.
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
// stubbed `getDb`. The repo (grouped lens pages) and the keyset codec are
// imported real — mocking either would defeat the very invariants these tests
// lock (the expanded boundary discipline and the rank ordinal threading).
const { selectServerPage, selectQualityPage } = await import("../repo");
// `selectFacets` is imported here too so the regression test can prove, in one
// place, that the facet key the popover surfaces is the SAME value the Server
// lens filter now matches on.
const { selectFacets } = await import("../repo");
const { __resetLibraryForTests } = await import("../repo");
const { serverToken, decodeServer, qualityToken, decodeQuality } =
  await import("../sources/keyset");
const { encode, decode } = await import("../../media");

let testDb: Db;

const USER_ID = "u1";

/** The bottom sentinel rank the SQL `CASE` assigns any label outside `QUALITY_TIERS`. */
const UNKNOWN_RANK = QUALITY_TIERS.length;

/** A row the grouped lenses page off, in the `library_items` insert shape. */
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
 * Inserts owned library rows directly into `library_items`, filling every
 * not-null column with a defaultable value so a test only sets the axis it
 * asserts on. The denormalized `servers` / `quality_tiers` columns are set
 * explicitly per test so the `json_each` expansion has real values to fan out
 * over. `owned` defaults to true so the rows land in the lens base
 * `owned = true` set; a test can override it to seed a tombstone.
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
 * A stable per-expanded-row key for assertions: `"<sectionId>|<id>"`. The Server
 * lens fans a title out once per server, so the distinguishing identity of an
 * expanded row is the `(section.id, library id)` pair — `id` alone repeats
 * across sections. This key lets the completeness assertions detect a drop or a
 * duplicate of any single expanded row.
 */
function serverKey(row: { section: { id: string }; id: string }): string {
  return `${row.section.id}|${row.id}`;
}

/**
 * The Quality twin of {@link serverKey}: `"<sectionId(tier)>|<id>"`. A title held
 * in two tiers fans out into two expanded rows whose only distinguishing key is
 * `(tier, library id)`.
 */
function qualityKey(row: { section: { id: string }; id: string }): string {
  return `${row.section.id}|${row.id}`;
}

/**
 * Walks every Server page from the first, threading the next cursor EXACTLY as
 * `sources/server.ts` does: the page's `nextRow` is encoded with `serverToken`,
 * wrapped in the opaque `{ mode: "keyset", k }` cursor, round-tripped through the
 * shared `encode`/`decode` codec a real request traverses, and decoded back to a
 * `ServerCursor` with `decodeServer`. Returns the ordered expanded rows the loop
 * emitted plus whether the final page exhausted the scan (no `nextRow`). A safety
 * cap turns an accidental infinite/duplicating loop into a failure, not a hang.
 */
async function walkServer(
  limit: number,
  filters: Parameters<typeof selectServerPage>[1] = {},
): Promise<{
  rows: { id: string; section: { id: string; label: string }; sortTitle: string }[];
  exhausted: boolean;
}> {
  const rows: { id: string; section: { id: string; label: string }; sortTitle: string }[] = [];
  let cursor: ReturnType<typeof decodeServer> = undefined;
  let exhausted = false;
  for (let guard = 0; guard < 1000; guard++) {
    const page = await selectServerPage(USER_ID, filters, cursor, limit);
    for (const row of page.rows) rows.push(row);
    if (!page.nextRow) {
      exhausted = true;
      break;
    }
    const raw = encode({ mode: "keyset", k: serverToken(page.nextRow) });
    cursor = decodeServer(decode(raw));
  }
  return { rows, exhausted };
}

/**
 * Quality twin of {@link walkServer}, threading `qualityToken`/`decodeQuality`
 * EXACTLY as `sources/quality.ts` does — including carrying the expanded row's
 * SQL `rank` ordinal back through the token rather than re-deriving it.
 */
async function walkQuality(
  limit: number,
  filters: Parameters<typeof selectQualityPage>[1] = {},
): Promise<{
  rows: { id: string; section: { id: string; label: string }; sortTitle: string; rank?: number }[];
  exhausted: boolean;
}> {
  const rows: {
    id: string;
    section: { id: string; label: string };
    sortTitle: string;
    rank?: number;
  }[] = [];
  let cursor: ReturnType<typeof decodeQuality> = undefined;
  let exhausted = false;
  for (let guard = 0; guard < 1000; guard++) {
    const page = await selectQualityPage(USER_ID, filters, cursor, limit);
    for (const row of page.rows) rows.push(row);
    if (!page.nextRow) {
      exhausted = true;
      break;
    }
    const raw = encode({ mode: "keyset", k: qualityToken(page.nextRow) });
    cursor = decodeQuality(decode(raw));
  }
  return { rows, exhausted };
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

describe("library grouped lens pages (design §The 5 lenses, phase 3 json_each expansion)", () => {
  // SERVER MULTI-SECTION — the load-bearing expansion invariant. A title owned on
  // TWO servers must appear in BOTH server sections (two expanded rows), and a
  // title on ONE server must appear exactly once. The `json_each(servers)` join
  // fans each owned row out once per server `{ id, label }`; if the expansion
  // collapsed to distinct-by-title (or only the first server), the two-server
  // title would lose a section and this fails. The section id/label must come
  // from the server object, not the library row.
  it("expands a title across every server section, and a single-server title once", async () => {
    await seed([
      {
        id: "movie:multi",
        sortTitle: "Multi",
        servers: [
          { id: "plex", label: "Plex" },
          { id: "jelly", label: "Jellyfin" },
        ],
      },
      { id: "movie:solo", sortTitle: "Solo", servers: [{ id: "plex", label: "Plex" }] },
    ]);

    const { rows } = await walkServer(100);

    // `movie:multi` surfaces once per server section; `movie:solo` only in plex.
    // Assert on the full `(section.id, library id)` pairs so a dropped section or
    // a duplicated row both fail.
    expect(rows.map(serverKey)).toEqual([
      "jelly|movie:multi",
      "plex|movie:multi",
      "plex|movie:solo",
    ]);

    // The section label rides through from the server object, distinct per
    // section — proving the label is read off `sv.value ->> 'label'`, not the
    // library id.
    const jelly = rows.find((r) => r.section.id === "jelly");
    expect(jelly?.section.label).toBe("Jellyfin");
    const plexMulti = rows.find((r) => r.section.id === "plex" && r.id === "movie:multi");
    expect(plexMulti?.section.label).toBe("Plex");
  });

  // SERVER KEYSET COMPLETENESS across boundaries — paging the whole EXPANDED set
  // in `limit`-sized hops, threading each page's `nextRow` back as the next cursor
  // EXACTLY as `sources/server.ts` does, must reconstruct one row per
  // `(title, server)` with NO drop and NO duplicate, ordered `(section.id,
  // sortTitle, id)`. With 5 expanded rows at limit 2 the loop crosses >=2 page
  // boundaries (pages of 2,2,1); an off-by-one in `toExpandedPage` (encoding the
  // dropped overflow row instead of the last returned one) drops or repeats the
  // boundary expanded row. A title on two servers makes the boundary fall mid-fan.
  it("pages the whole expanded Server set across boundaries with no drops or duplicates", async () => {
    await seed([
      // `movie:ab` fans into both `alpha` and `beta`; the rest sit in one section
      // each. Sorted by `(section.id, sortTitle, id)` the expanded order is:
      //   alpha|movie:ab, alpha|movie:aonly,
      //   beta|movie:ab, beta|movie:bonly,
      //   gamma|movie:gonly
      {
        id: "movie:ab",
        sortTitle: "Across",
        servers: [
          { id: "alpha", label: "Alpha" },
          { id: "beta", label: "Beta" },
        ],
      },
      { id: "movie:aonly", sortTitle: "Aonly", servers: [{ id: "alpha", label: "Alpha" }] },
      { id: "movie:bonly", sortTitle: "Bonly", servers: [{ id: "beta", label: "Beta" }] },
      { id: "movie:gonly", sortTitle: "Gonly", servers: [{ id: "gamma", label: "Gamma" }] },
    ]);

    const { rows, exhausted } = await walkServer(2);

    // The full expanded set in `(section.id, sortTitle, id)` order — exactly once
    // each, in order. `toEqual` on the ordered key array asserts order, no-skip,
    // and no-duplicate in one shot. The cursor crossed the `alpha -> beta` and
    // `beta -> gamma` section boundaries (and one within-section boundary), so a
    // broken last-returned-vs-overflow discipline drops or doubles a key here.
    expect(rows.map(serverKey)).toEqual([
      "alpha|movie:ab",
      "alpha|movie:aonly",
      "beta|movie:ab",
      "beta|movie:bonly",
      "gamma|movie:gonly",
    ]);
    expect(new Set(rows.map(serverKey)).size).toBe(5);
    expect(rows).toHaveLength(5);
    // The final short read emitted no next cursor, so the pipeline ends the scan
    // rather than looping forever.
    expect(exhausted).toBe(true);
  });

  // QUALITY KEYSET + RANK — the expanded set is ordered HIGHEST-FIDELITY FIRST by
  // the `QUALITY_TIERS` ordinal (rank ascending), an UNKNOWN label sorts LAST
  // (rank == QUALITY_TIERS.length), ties broken by `(sortTitle, id)`, and the full
  // set reconstructs with no drop/dup across a boundary. Paging in hops of 2
  // crosses tier-section boundaries; because the cursor predicate and the
  // `ORDER BY` share ONE rank `CASE`, the boundary is stable. If the rank were
  // re-derived (or the unknown label ranked above a known tier) the order or the
  // boundary would break and this fails.
  it("pages the expanded Quality set highest-fidelity first, unknown last, no drops or duplicates", async () => {
    // "4K HDR" is rank 0 (highest), "1080p" is rank 4, "Bootleg" is unknown
    // (rank == QUALITY_TIERS.length). `movie:dual` is held in both "4K HDR" and
    // "1080p", so it fans into two tier sections. Expected expanded order:
    //   4K HDR : movie:dual (rank 0)
    //   1080p  : movie:dual, movie:hd (rank 4, tie-broken by sortTitle/id)
    //   Bootleg: movie:low (rank UNKNOWN_RANK)
    await seed([
      { id: "movie:dual", sortTitle: "Dual", qualityTiers: ["1080p", "4K HDR"] },
      { id: "movie:hd", sortTitle: "Hd", qualityTiers: ["1080p"] },
      { id: "movie:low", sortTitle: "Low", qualityTiers: ["Bootleg"] },
    ]);

    const { rows, exhausted } = await walkQuality(2);

    // Highest-fidelity first by rank ordinal; the unknown tier last; the 1080p
    // tie broken by `(sortTitle, id)`. `toEqual` on the ordered keys asserts the
    // ordering, no-skip and no-duplicate across the boundary in one shot.
    expect(rows.map(qualityKey)).toEqual([
      "4K HDR|movie:dual",
      "1080p|movie:dual",
      "1080p|movie:hd",
      "Bootleg|movie:low",
    ]);
    expect(new Set(rows.map(qualityKey)).size).toBe(4);
    expect(rows).toHaveLength(4);
    expect(exhausted).toBe(true);

    // The rank ordinal the source threaded through the token is the SQL `CASE`
    // value: 0 for "4K HDR", 4 for "1080p", and the bottom sentinel for the
    // unknown label. This is what keeps the hop token comparable to the cursor
    // predicate's numeric rank — assert it explicitly so a re-derived-or-dropped
    // rank fails here, not silently.
    const byKey = new Map(rows.map((r) => [qualityKey(r), r] as const));
    expect(byKey.get("4K HDR|movie:dual")?.rank).toBe(QUALITY_TIERS.indexOf("4K HDR"));
    expect(byKey.get("1080p|movie:hd")?.rank).toBe(QUALITY_TIERS.indexOf("1080p"));
    expect(byKey.get("Bootleg|movie:low")?.rank).toBe(UNKNOWN_RANK);
    // The unknown tier really did sort to the very end (rank == tuple length).
    expect(rows[rows.length - 1]?.section.id).toBe("Bootleg");
  });

  // CURSOR CODEC — the grouped resume tuples must survive a full encode->decode
  // round-trip for both lenses, and EVERY bad-cursor path must degrade to
  // `undefined` (read as "first page") and NEVER throw. This is the V.CU1
  // "a hand-edited cursor degrades, never 400s" invariant, applied to the
  // three-part grouped tokens.
  it("round-trips a grouped keyset cursor and folds every bad cursor to first-page", () => {
    // Server round-trip: a `sortTitle` WITH a space proves `splitTriToken` peels
    // the FIRST space (section id) and the LAST space (library id), recovering the
    // full middle sortTitle.
    const serverRow = {
      section: { id: "plex", label: "Plex" },
      sortTitle: "The Matrix",
      id: "movie:603",
    } as Parameters<typeof serverToken>[0];
    expect(decodeServer(decode(encode({ mode: "keyset", k: serverToken(serverRow) })))).toEqual({
      sectionId: "plex",
      sortTitle: "The Matrix",
      id: "movie:603",
    });

    // Quality round-trip: the rank ordinal parses back to a finite integer, the
    // middle sortTitle (with a space) survives, and the id survives.
    const qualityRow = {
      section: { id: "4K HDR", label: "4K HDR" },
      sortTitle: "The Matrix",
      id: "movie:603",
      rank: 0,
    } as Parameters<typeof qualityToken>[0];
    expect(decodeQuality(decode(encode({ mode: "keyset", k: qualityToken(qualityRow) })))).toEqual({
      tierRank: 0,
      sortTitle: "The Matrix",
      id: "movie:603",
    });

    // A null cursor (none supplied) is first-page for both grouped lenses.
    expect(decodeServer(null)).toBeUndefined();
    expect(decodeQuality(null)).toBeUndefined();

    // A foreign (offset) cursor is not a keyset cursor → first-page, no throw.
    const offset = decode(encode({ mode: "offset", n: 5 }));
    expect(() => decodeServer(offset)).not.toThrow();
    expect(decodeServer(offset)).toBeUndefined();
    expect(decodeQuality(offset)).toBeUndefined();

    // An empty token has no spaces → first-page for both.
    expect(decodeServer(decode(encode({ mode: "keyset", k: "" })))).toBeUndefined();
    expect(decodeQuality(decode(encode({ mode: "keyset", k: "" })))).toBeUndefined();

    // A two-part token (only ONE space) lacks the third grouped component →
    // first-page, never a partial cursor that drops the section/rank key.
    expect(decodeServer(decode(encode({ mode: "keyset", k: "plex movie:1" })))).toBeUndefined();
    expect(decodeQuality(decode(encode({ mode: "keyset", k: "0 movie:1" })))).toBeUndefined();

    // A trailing space (empty id) → first-page.
    expect(decodeServer(decode(encode({ mode: "keyset", k: "plex Title " })))).toBeUndefined();

    // A quality token whose head is not a finite number → first-page rather than
    // flowing a NaN rank into the keyset comparison.
    expect(
      decodeQuality(decode(encode({ mode: "keyset", k: "notanumber Title movie:1" }))),
    ).toBeUndefined();

    // A malformed/garbage opaque cursor decodes to null upstream, so both grouped
    // decoders fold it to first-page and never throw.
    expect(() => decodeServer(decode("@@@not-base64-json@@@"))).not.toThrow();
    expect(decodeServer(decode("@@@not-base64-json@@@"))).toBeUndefined();
    expect(decodeQuality(decode("@@@not-base64-json@@@"))).toBeUndefined();
  });

  // FILTERS NARROW THE EXPANDED TITLE SET — a filter axis narrows which TITLES
  // appear, applied in SQL as a row-scoped `json_each EXISTS` membership (design
  // §Filters; §Schema line: "servers=json_each EXISTS"). The `servers` axis
  // matches on the human-readable `label` (`"Plex"`), NOT the connection id, so
  // it agrees with the facet key and the FE popover value (see the regression
  // test below). A `servers: ["Plex"]` filter keeps every title available on
  // Plex and DROPS every title not on Plex entirely; a kept multi-server title
  // still fans out across ALL its sections (the filter narrows titles, not
  // sections — the expansion is unchanged). The mutation-sensitive invariant: a
  // title NOT on Plex must vanish completely, while a title ON Plex keeps every
  // one of its sections.
  it("narrows the expanded Server set to titles matching the filter, fanning kept titles across all sections", async () => {
    await seed([
      {
        id: "movie:both",
        sortTitle: "Both",
        servers: [
          { id: "plex", label: "Plex" },
          { id: "jelly", label: "Jellyfin" },
        ],
      },
      {
        id: "movie:jellyonly",
        sortTitle: "JellyOnly",
        servers: [{ id: "jelly", label: "Jellyfin" }],
      },
    ]);

    const { rows } = await walkServer(100, { servers: ["Plex"] });

    // `movie:jellyonly` (not on Plex) is dropped ENTIRELY — the filter's
    // row-scoped `EXISTS` excludes the whole title. `movie:both` (on Plex) is
    // kept and still expands across BOTH its server sections, because the filter
    // narrows the title set, never the per-title expansion. A filter that leaked
    // the jelly-only title, or one that collapsed `movie:both` to just its plex
    // section, both fail here.
    expect(rows.map(serverKey)).toEqual(["jelly|movie:both", "plex|movie:both"]);
    // The excluded title contributes no section at all.
    expect(rows.some((r) => r.id === "movie:jellyonly")).toBe(false);
  });

  // SERVERS FILTER MATCHES ON LABEL, NOT ID — the regression guard for the
  // facet-key / filter-value mismatch. The facets repo keys the `servers` count
  // map on `je.value ->> 'label'`, and the FE popover sends that same label back
  // as `filters.servers`; the lens filter predicate (`ownedFilterConditions`'s
  // servers arm) must therefore match on `label` too, or selecting any server
  // facet matches NO row. We seed one owned title on `{ id: "conn-1", label:
  // "Plex" }` and prove the two axes now agree: filtering by the LABEL the facet
  // surfaces keeps the title, while filtering by the connection id keeps nothing.
  // If the predicate regressed to `value ->> 'id'`, the label filter would match
  // nothing and the first assertion would fail. The Server LENS still SECTIONS on
  // the id (asserted via `section.id` below) — that grouping axis is unchanged.
  it("filters the Server lens on the server LABEL (facet key), not the connection id", async () => {
    await seed([{ id: "movie:1", sortTitle: "Alpha", servers: [{ id: "conn-1", label: "Plex" }] }]);

    // (a) The facets `servers` map keys on the human LABEL, so the popover badge
    // and the filter value both read "Plex" — never the opaque "conn-1" id.
    const facets = await selectFacets(USER_ID);
    expect(facets.servers).toEqual({ Plex: 1 });

    // The LABEL is what the facet map keys on and what the popover sends back, so
    // it must KEEP the title.
    const byLabel = await walkServer(100, { servers: ["Plex"] });
    expect(byLabel.rows.map((r) => r.id)).toEqual(["movie:1"]);
    // The lens still SECTIONS on the connection id — the section grouping axis is
    // separate from the (now label-keyed) filter axis.
    expect(byLabel.rows[0]?.section).toEqual({ id: "conn-1", label: "Plex" });

    // The connection id is NO LONGER the filter value: it matches nothing, since
    // the predicate now compares `value ->> 'label'`. This is the half of the
    // pair that proves the bug is fixed — under the old `value ->> 'id'`
    // predicate this filter would have (wrongly) kept the title.
    const byId = await walkServer(100, { servers: ["conn-1"] });
    expect(byId.rows).toHaveLength(0);
  });
});
