import { consola } from "consola";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ActiveRow } from "@ent-mcp/shared/media";
import { keyToId } from "@ent-mcp/shared/watchlist";
import type { SourceContext } from "../../../media";
import type { MoodParams } from "../mood-items";

// The source reads rows through the media barrel's `listActiveRowsKeyset`; mock
// just that so the test stays env/db-free (the barrel otherwise drags
// `db/client` → `env`). The mood predicate (`deriveMoods`) and the accumulation
// loop live in the source, so they run for real against the stubbed metadata.
vi.mock("../../../media", () => ({
  listActiveRowsKeyset: vi.fn(async () => [] as ActiveRow[]),
}));

const media = await import("../../../media");
const { moodItemsSource } = await import("../mood-items");

function row(tmdbId: string, addedAt: number): ActiveRow {
  return {
    id: `id-${tmdbId}`,
    userId: "u1",
    tmdbId,
    mediaType: "movie",
    state: "active",
    source: "manual",
    addedAt,
    removedAt: null,
    seeded: false,
  };
}

/** A `getMetadataBatch` that tags only the given tmdbIds with a `dark` genre. */
function darkMetaFor(darkIds: Set<string>) {
  return vi.fn(async (keys: { tmdbId: string; type: "movie" | "tv" }[]) => {
    const out: Record<string, unknown> = {};
    for (const { tmdbId, type } of keys) {
      if (darkIds.has(tmdbId)) {
        out[keyToId({ tmdbId, mediaType: type })] = {
          tmdbId,
          mediaType: type,
          title: tmdbId,
          genres: ["Horror"],
        };
      }
    }
    return out;
  });
}

function makeCtx(darkIds: Set<string>): SourceContext {
  return {
    userId: "u1",
    mediaService: {
      getStatusBatch: vi.fn(async () => ({})),
    } as unknown as SourceContext["mediaService"],
    catalog: { getMetadataBatch: darkMetaFor(darkIds) } as unknown as SourceContext["catalog"],
    statusBatch: {} as SourceContext["statusBatch"],
    logger: consola.withTag("mood-items-test"),
  };
}

const params = (over: Partial<MoodParams> = {}): MoodParams => ({
  moodId: "dark",
  limit: 3,
  ...over,
});

beforeEach(() => {
  vi.mocked(media.listActiveRowsKeyset).mockReset().mockResolvedValue([]);
});

// The source declares the pipeline stages and owns the mood predicate +
// multi-hop accumulation (design §S.3). If the keyset/recentDesc/mood-filter
// routing or the sparse-mood accumulation regresses, mood pages silently
// truncate or paginate wrong — these tests pin that contract (Rule 9).
describe("moodItemsSource.stages (design §S.3)", () => {
  it("declares preapplied filter + keyset/recentDesc stages", () => {
    // `preapplied` signals the pipeline that the mood predicate already ran
    // source-side; the pipeline filter stage MUST NOT re-derive mood (V.WL3).
    expect(moodItemsSource.stages).toEqual({
      filter: "preapplied",
      sort: "recentDesc",
      cursorMode: "keyset",
    });
  });
});

describe("moodItemsSource.fetchRawSet (V.MC1 — RAW rows only)", () => {
  it("returns only the mood-matched raw rows and mints nextRaw when the page fills mid-window", async () => {
    // limit 2 → fetchSize 6; a full window of 6 rows where the first 2 are dark.
    const rows = ["a", "b", "c", "d", "e", "f"].map((t, i) => row(t, 6 - i));
    vi.mocked(media.listActiveRowsKeyset).mockResolvedValueOnce(rows);

    const res = await moodItemsSource.fetchRawSet(
      makeCtx(new Set(["a", "b"])),
      params({ limit: 2 }),
      null,
    );

    // The source filtered to the dark rows but did not enrich/sort — raw rows.
    expect(res.rows.map((r) => r.tmdbId)).toEqual(["a", "b"]);
    // Window was full (6 === fetchSize) so more may exist → hop token threaded.
    expect(res.nextRaw).toBe("5:id-b");
    expect(res.partial).toBe(false);
  });

  it("accumulates matches across windows when the mood is sparse", async () => {
    // limit 2 → fetchSize 6. One dark match at the tail of each full window.
    const w1 = ["a1", "a2", "a3", "a4", "a5", "d1"].map((t, i) => row(t, 100 - i));
    const w2 = ["b1", "b2", "b3", "b4", "b5", "d2"].map((t, i) => row(t, 90 - i));
    vi.mocked(media.listActiveRowsKeyset).mockResolvedValueOnce(w1).mockResolvedValueOnce(w2);

    const res = await moodItemsSource.fetchRawSet(
      makeCtx(new Set(["d1", "d2"])),
      params({ limit: 2 }),
      null,
    );

    expect(res.rows.map((r) => r.tmdbId)).toEqual(["d1", "d2"]);
    expect(media.listActiveRowsKeyset).toHaveBeenCalledTimes(2);
  });

  it("omits nextRaw (cursor:null, #500) when the empty-streak budget exits with no matches", async () => {
    // limit 1 → fetchSize 3. Three full windows, none dark → empty streak gives up.
    const win = (p: string) => [`${p}1`, `${p}2`, `${p}3`].map((t, i) => row(t, 100 - i));
    vi.mocked(media.listActiveRowsKeyset)
      .mockResolvedValueOnce(win("a"))
      .mockResolvedValueOnce(win("b"))
      .mockResolvedValueOnce(win("c"));

    const res = await moodItemsSource.fetchRawSet(makeCtx(new Set()), params({ limit: 1 }), null);

    expect(res.rows).toEqual([]);
    expect("nextRaw" in res).toBe(false);
  });

  it("ignores a foreign (offset) cursor and starts from the first page (V.CU1)", async () => {
    vi.mocked(media.listActiveRowsKeyset).mockResolvedValueOnce([]);

    await moodItemsSource.fetchRawSet(makeCtx(new Set()), params(), { mode: "offset", n: 5 });

    // The offset cursor is dropped — the keyset scan starts from the first page.
    expect(media.listActiveRowsKeyset).toHaveBeenCalledWith("u1", { limit: 9 });
  });

  it("resumes the scan from its own keyset cursor's 'addedAt:id'", async () => {
    vi.mocked(media.listActiveRowsKeyset).mockResolvedValueOnce([]);

    await moodItemsSource.fetchRawSet(makeCtx(new Set()), params(), {
      mode: "keyset",
      k: "42:id-a",
    });

    expect(media.listActiveRowsKeyset).toHaveBeenCalledWith("u1", {
      limit: 9,
      cursor: { addedAt: 42, id: "id-a" },
    });
  });
});
