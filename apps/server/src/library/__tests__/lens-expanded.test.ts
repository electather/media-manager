import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { QUALITY_TIERS } from "@nama/shared/library";
import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../__tests__/helpers/in-memory-db";
import { user } from "../../db/schema/auth";
import { libraryItems } from "../../db/schema/library";

// Stub `env` and point `getDb()` at real in-memory db (not mocked repo). The
// `json_each` expansion, keyset ORDER BY, and quality rank CASE can only be
// proven against the real SQLite query planner — off-by-one boundary and
// rank-vs-cursor mismatch never reproduce with a mock.
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

/** Inserts owned library rows with denormalized `servers` / `quality_tiers` set
 * explicitly so `json_each` expansion has real values. `owned` defaults to true;
 * override to seed a tombstone.
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

/** Stable per-expanded-row key `"<sectionId>|<id>"` for assertions: the Server
 * lens fans a title per server, so identity is `(section.id, library id)` —
 * `id` alone repeats across sections. Detects dropped/duplicated rows.
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

/** Walks every Server page, threading the next cursor EXACTLY as
 * `sources/server.ts` does: encode `nextRow` with `serverToken`, wrap in
 * `{ mode: "keyset", k }`, round-trip through real `encode`/`decode` codec,
 * decode back to `ServerCursor`. Safety cap prevents infinite/duplicate loops.
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

/** Quality twin of {@link walkServer}, threading `qualityToken`/`decodeQuality`
 * EXACTLY as `sources/quality.ts` does — carry SQL `rank` ordinal through the
 * token rather than re-deriving it.
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
  // TWO servers must appear in BOTH server sections. The `json_each(servers)` join
  // fans each row once per server; collapsed-to-distinct-by-title or only-first
  // server would drop a section. Section id/label must come from server object.
  // (design §The 5 lenses, phase 3 json_each expansion)
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

    // Section label comes from server object via `sv.value ->> 'label'`, not library id.
    const jelly = rows.find((r) => r.section.id === "jelly");
    expect(jelly?.section.label).toBe("Jellyfin");
    const plexMulti = rows.find((r) => r.section.id === "plex" && r.id === "movie:multi");
    expect(plexMulti?.section.label).toBe("Plex");
  });

  // SERVER KEYSET COMPLETENESS — paging the whole expanded set, threading
  // `nextRow` back as cursor EXACTLY as `sources/server.ts` does, must
  // reconstruct each `(title, server)` pair with NO drop/duplicate, order
  // `(section.id, sortTitle, id)`. Off-by-one in `toExpandedPage` (encoding
  // dropped-overflow instead of last-returned) drops or repeats boundary row.
  // Title on two servers makes boundary fall mid-fan.
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

  // QUALITY KEYSET + RANK — ordered HIGHEST-FIDELITY FIRST by `QUALITY_TIERS`
  // ordinal (rank ascending), UNKNOWN label sorts LAST (rank == QUALITY_TIERS.length),
  // ties broken by `(sortTitle, id)`, full set reconstructs no drop/dup. Cursor
  // predicate and ORDER BY share ONE rank CASE → stable boundary. If rank were
  // re-derived or unknown ranked above known tier, order/boundary breaks.
  it("pages the expanded Quality set highest-fidelity first, unknown last, no drops or duplicates", async () => {
    // "4K HDR" rank 0, "1080p" rank 4, "Bootleg" unknown (rank == QUALITY_TIERS.length).
    // `movie:dual` fans into two tier sections. Expected: 4K HDR|dual, 1080p|{dual, hd}, Bootleg|low.
    await seed([
      { id: "movie:dual", sortTitle: "Dual", qualityTiers: ["1080p", "4K HDR"] },
      { id: "movie:hd", sortTitle: "Hd", qualityTiers: ["1080p"] },
      { id: "movie:low", sortTitle: "Low", qualityTiers: ["Bootleg"] },
    ]);

    const { rows, exhausted } = await walkQuality(2);

    // Highest-fidelity first by rank; unknown tier last; 1080p tie broken by
    // `(sortTitle, id)`. `toEqual` asserts ordering, no-skip, no-duplicate across boundary.
    expect(rows.map(qualityKey)).toEqual([
      "4K HDR|movie:dual",
      "1080p|movie:dual",
      "1080p|movie:hd",
      "Bootleg|movie:low",
    ]);
    expect(new Set(rows.map(qualityKey)).size).toBe(4);
    expect(rows).toHaveLength(4);
    expect(exhausted).toBe(true);

    // The rank ordinal threaded through token is the SQL CASE value: 0, 4,
    // UNKNOWN_RANK. Assert explicitly so a re-derived-or-dropped rank fails here.
    const byKey = new Map(rows.map((r) => [qualityKey(r), r] as const));
    expect(byKey.get("4K HDR|movie:dual")?.rank).toBe(QUALITY_TIERS.indexOf("4K HDR"));
    expect(byKey.get("1080p|movie:hd")?.rank).toBe(QUALITY_TIERS.indexOf("1080p"));
    expect(byKey.get("Bootleg|movie:low")?.rank).toBe(UNKNOWN_RANK);
    // The unknown tier really did sort to the very end (rank == tuple length).
    expect(rows[rows.length - 1]?.section.id).toBe("Bootleg");
  });

  // CURSOR CODEC — grouped resume tuples survive full encode->decode round-trip,
  // EVERY bad-cursor path degrades to `undefined` (first page), never throws
  // (V.CU1 invariant: hand-edited cursor degrades, never 400s).
  it("round-trips a grouped keyset cursor and folds every bad cursor to first-page", () => {
    // Server round-trip: a `sortTitle` with a space proves `splitTriToken` peels
    // FIRST space (section id) and LAST space (library id), recovering middle sortTitle.
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

    // Quality round-trip: rank ordinal, sortTitle with space, and id all survive.
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

  // FILTERS NARROW THE EXPANDED TITLE SET — applied as row-scoped `json_each EXISTS`
  // (design §Filters; §Schema). `servers` axis matches `label` not connection id
  // (agrees with facet key and FE popover — see regression test). `servers: ["Plex"]`
  // keeps titles available on Plex, DROPS others entirely; kept multi-server titles
  // still fan across ALL sections (filter narrows titles, not sections). Invariant:
  // title NOT on Plex vanishes completely; title ON Plex keeps every section.
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

    // `movie:jellyonly` (not on Plex) is dropped ENTIRELY via row-scoped `EXISTS`.
    // `movie:both` (on Plex) is kept and expands across BOTH sections (filter
    // narrows titles, never per-title expansion). Leak or collapse both fail.
    expect(rows.map(serverKey)).toEqual(["jelly|movie:both", "plex|movie:both"]);
    // The excluded title contributes no section at all.
    expect(rows.some((r) => r.id === "movie:jellyonly")).toBe(false);
  });

  // SERVERS FILTER MATCHES ON LABEL, NOT ID — regression guard for facet-key /
  // filter-value mismatch. Facets repo keys `servers` map on `je.value ->> 'label'`,
  // FE popover sends that label back as `filters.servers`, predicate must match on
  // `label` too. Regression to `value ->> 'id'` → label filter matches nothing.
  // Server LENS still SECTIONS on id (asserted via `section.id` below).
  it("filters the Server lens on the server LABEL (facet key), not the connection id", async () => {
    await seed([{ id: "movie:1", sortTitle: "Alpha", servers: [{ id: "conn-1", label: "Plex" }] }]);

    // (a) Facets `servers` map keys on human LABEL, never opaque "conn-1" id.
    const facets = await selectFacets(USER_ID);
    expect(facets.servers).toEqual({ Plex: 1 });

    // LABEL keys facet map and popover value, so it must KEEP the title.
    const byLabel = await walkServer(100, { servers: ["Plex"] });
    expect(byLabel.rows.map((r) => r.id)).toEqual(["movie:1"]);
    // Lens SECTIONS on connection id (grouping axis separate from filter axis).
    expect(byLabel.rows[0]?.section).toEqual({ id: "conn-1", label: "Plex" });

    // Connection id is NO LONGER the filter value (predicate compares `value ->> 'label'`).
    // This half proves the bug is fixed — old `value ->> 'id'` would wrongly keep title.
    const byId = await walkServer(100, { servers: ["conn-1"] });
    expect(byId.rows).toHaveLength(0);
  });
});
