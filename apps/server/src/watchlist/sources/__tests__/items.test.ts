import { consola } from "consola";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ActiveRow } from "@nama/shared/media";
import type { SourceContext } from "../../../media";
import type { ItemsParams } from "../items";

// The source pulls `listActiveRowsKeyset`/`listAllActiveRows` from the media
// barrel; mock just those so the test stays env/db-free (the barrel otherwise
// drags `db/client` → `env`). Everything else (sort/filter/cursor) lives in the
// source or the pipeline, not these two reads.
vi.mock("../../../media", () => ({
  listActiveRowsKeyset: vi.fn(async () => [] as ActiveRow[]),
  listAllActiveRows: vi.fn(async () => [] as ActiveRow[]),
}));

const media = await import("../../../media");
const { itemsSource } = await import("../items");

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

function makeCtx(overrides: Partial<SourceContext> = {}): SourceContext {
  return {
    userId: "u1",
    mediaService: {
      getStatusBatch: vi.fn(async () => ({})),
    } as unknown as SourceContext["mediaService"],
    catalog: { getMetadataBatch: vi.fn(async () => ({})) } as unknown as SourceContext["catalog"],
    statusBatch: {} as SourceContext["statusBatch"],
    logger: consola.withTag("items-test"),
    ...overrides,
  };
}

const params = (over: Partial<ItemsParams> = {}): ItemsParams => ({
  limit: 10,
  sort: "recent",
  ...over,
});

beforeEach(() => {
  vi.mocked(media.listActiveRowsKeyset).mockReset().mockResolvedValue([]);
  vi.mocked(media.listAllActiveRows).mockReset().mockResolvedValue([]);
});

// design §S.1: `recent`+unfiltered is keyset, filters/non-recent sorts ride offset (preserving #501),
// `alpha`/`runtime`/`status` pre-sorted by source as `sort:"none"` since RowSort can't express them.
// Silent pagination break on regression.
describe("itemsSource.stages routing (design §S.1)", () => {
  it("recent + no filter → keyset/recentDesc/no-filter", () => {
    expect(itemsSource(params()).stages).toEqual({
      classify: true,
      filter: undefined,
      sort: "recentDesc",
      cursorMode: "keyset",
    });
  });

  it("recent + bucket → offset (full-set classify+filter, #501), recentDesc, bucket filter", () => {
    const s = itemsSource(params({ bucket: "ready" }));
    expect(s.stages.cursorMode).toBe("offset");
    expect(s.stages.sort).toBe("recentDesc");
    expect(s.stages.filter).toBe("bucket");
  });

  it("recent + mood → offset, preapplied filter (mood ran source-side)", () => {
    const s = itemsSource(params({ mood: "dark" }));
    expect(s.stages.cursorMode).toBe("offset");
    expect(s.stages.filter).toBe("preapplied");
  });

  it("alpha → offset with sort 'none' (source pre-sorts; RowSort can't express alpha)", () => {
    const s = itemsSource(params({ sort: "alpha" }));
    expect(s.stages.cursorMode).toBe("offset");
    expect(s.stages.sort).toBe("none");
  });
});

describe("itemsSource.fetchRawSet (V.MC1 — RAW rows only)", () => {
  it("keyset read returns the raw rows untouched and mints nextRaw only on a full window", async () => {
    const rows = [row("a", 3), row("b", 2)];
    vi.mocked(media.listActiveRowsKeyset).mockResolvedValueOnce(rows);

    const res = await itemsSource(params({ limit: 2 })).fetchRawSet(
      makeCtx(),
      params({ limit: 2 }),
      null,
    );

    // The source did not enrich/classify/sort — it returned the raw rows as-is.
    expect(res.rows).toBe(rows);
    // Window was full (2 === limit), so the source threads back the hop token.
    expect(res.nextRaw).toBe("2:id-b");
    expect(res.partial).toBe(false);
  });

  it("keyset read omits nextRaw on a short window so paginate emits cursor:null (#500)", async () => {
    vi.mocked(media.listActiveRowsKeyset).mockResolvedValueOnce([row("a", 3)]);

    const res = await itemsSource(params({ limit: 2 })).fetchRawSet(
      makeCtx(),
      params({ limit: 2 }),
      null,
    );

    expect(res.nextRaw).toBeUndefined();
  });

  it("a foreign (offset) cursor on a keyset read falls back to the first page, never throws (V.CU1)", async () => {
    vi.mocked(media.listActiveRowsKeyset).mockResolvedValueOnce([]);

    await itemsSource(params()).fetchRawSet(makeCtx(), params(), { mode: "offset", n: 5 });

    // The offset cursor is ignored — the keyset read starts from the first page.
    expect(media.listActiveRowsKeyset).toHaveBeenCalledWith("u1", { limit: 10 });
  });

  it("keyset read decodes its own cursor's 'addedAt:id' hop position", async () => {
    vi.mocked(media.listActiveRowsKeyset).mockResolvedValueOnce([]);

    await itemsSource(params()).fetchRawSet(makeCtx(), params(), { mode: "keyset", k: "42:id-a" });

    expect(media.listActiveRowsKeyset).toHaveBeenCalledWith("u1", {
      limit: 10,
      cursor: { addedAt: 42, id: "id-a" },
    });
  });

  it("alpha offset read pre-sorts the raw rows by catalog title (RowSort cannot)", async () => {
    const rows = [row("c", 3), row("a", 2), row("b", 1)];
    vi.mocked(media.listAllActiveRows).mockResolvedValueOnce(rows);
    const ctx = makeCtx();
    (ctx.catalog.getMetadataBatch as ReturnType<typeof vi.fn>).mockResolvedValue({
      "movie:c": { tmdbId: "c", mediaType: "movie", title: "Charlie", genres: [] },
      "movie:a": { tmdbId: "a", mediaType: "movie", title: "Alpha", genres: [] },
      "movie:b": { tmdbId: "b", mediaType: "movie", title: "Bravo", genres: [] },
    });

    const res = await itemsSource(params({ sort: "alpha" })).fetchRawSet(
      ctx,
      params({ sort: "alpha" }),
      null,
    );

    expect(res.rows.map((r) => r.tmdbId)).toEqual(["a", "b", "c"]);
    // Offset sources never mint a keyset hop token.
    expect("nextRaw" in res).toBe(false);
  });

  // Under sensitivity:"accent" "elite" and "ELITE" return 0 from primary compare;
  // secondary full-collation pass breaks ties deterministically (without it, JS stability differs across environments).
  // Test catches regression removing the secondary compare.
  it("alpha sort breaks ties between case-colliding titles deterministically", async () => {
    const rows = [row("2", 3), row("1", 2)];
    vi.mocked(media.listAllActiveRows).mockResolvedValueOnce(rows);
    const ctx = makeCtx();
    // "ELITE" and "elite" compare as equal under sensitivity:"accent"
    // (case-insensitive), so the secondary full-collation pass must produce
    // "elite" < "ELITE".
    (ctx.catalog.getMetadataBatch as ReturnType<typeof vi.fn>).mockResolvedValue({
      "movie:2": { tmdbId: "2", mediaType: "movie", title: "ELITE", genres: [] },
      "movie:1": { tmdbId: "1", mediaType: "movie", title: "elite", genres: [] },
    });

    const res = await itemsSource(params({ sort: "alpha" })).fetchRawSet(
      ctx,
      params({ sort: "alpha" }),
      null,
    );

    // "elite" should sort before "ELITE" regardless of the input row order.
    expect(res.rows.map((r) => r.tmdbId)).toEqual(["1", "2"]);
  });

  // On `getStatusBatch` rejection: MUST surface `partial:true` so client can show degradation banner.
  // Regression silently dropping `partial` would render identical-looking page with no warning.
  it("status sort surfaces partial:true when getStatusBatch rejects", async () => {
    const rows = [row("a", 3), row("b", 2)];
    vi.mocked(media.listAllActiveRows).mockResolvedValueOnce(rows);
    const ctx = makeCtx();
    (ctx.mediaService.getStatusBatch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("status batch boom"),
    );
    (ctx.catalog.getMetadataBatch as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const res = await itemsSource(params({ sort: "status" })).fetchRawSet(
      ctx,
      params({ sort: "status" }),
      null,
    );

    expect(res.partial).toBe(true);
    // Rows are still returned so the page renders — just at the degraded sort.
    expect(res.rows.map((r) => r.tmdbId).sort()).toEqual(["a", "b"]);
  });
});
