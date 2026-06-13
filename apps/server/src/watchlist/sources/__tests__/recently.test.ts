import { consola } from "consola";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ActiveRow } from "@nama/shared/media";
import type { SourceContext } from "../../../media";

// The source pulls `listActiveRowsKeyset` from the media barrel; mock just that
// so the test stays env/db-free (the barrel otherwise drags `db/client` →
// `env`). Enrich/sort/paginate live in the pipeline, not this source.
vi.mock("../../../media", () => ({
  listActiveRowsKeyset: vi.fn(async () => [] as ActiveRow[]),
}));

const media = await import("../../../media");
const { recentlySource, recentlyCfg } = await import("../recently");

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

function makeCtx(): SourceContext {
  return {
    userId: "u1",
    mediaService: {} as SourceContext["mediaService"],
    catalog: {} as SourceContext["catalog"],
    statusBatch: {} as SourceContext["statusBatch"],
    logger: consola.withTag("recently-test"),
  };
}

beforeEach(() => {
  vi.mocked(media.listActiveRowsKeyset).mockReset().mockResolvedValue([]);
});

// Recently-added is a bounded preview: the pipeline must sort `addedAt` DESC and
// never paginate it. If the stages regress (e.g. an offset cursor mode), the
// preview could surface a stale page or a phantom load-more.
describe("recentlySource.stages (design §S.4)", () => {
  it("declares a recentDesc, bounded keyset page", () => {
    expect(recentlySource.stages).toEqual({ sort: "recentDesc", cursorMode: "keyset" });
  });

  it("recentlyCfg is the first `limit` rows with no incoming cursor", () => {
    expect(recentlyCfg({ limit: 3 })).toEqual({ params: { limit: 3 }, cursor: null, limit: 3 });
  });
});

describe("recentlySource.fetchRawSet (V.MC1 — RAW rows only)", () => {
  it("returns the raw first keyset window untouched, with no nextRaw (bounded preview)", async () => {
    const rows = [row("a", 3), row("b", 2), row("c", 1)];
    vi.mocked(media.listActiveRowsKeyset).mockResolvedValueOnce(rows);

    const res = await recentlySource.fetchRawSet(makeCtx(), { limit: 3 }, null);

    // The source did not enrich/sort — it returned the raw rows as-is.
    expect(res.rows).toBe(rows);
    expect(res.partial).toBe(false);
    // A bounded preview never paginates → no hop token → pipeline mints cursor:null.
    expect("nextRaw" in res).toBe(false);
  });

  it("requests exactly `limit` rows from the first window (no cursor, no over-fetch)", async () => {
    await recentlySource.fetchRawSet(makeCtx(), { limit: 5 }, null);

    expect(media.listActiveRowsKeyset).toHaveBeenCalledWith("u1", { limit: 5 });
  });

  it("ignores any incoming cursor — recently is always the first page (V.CU1)", async () => {
    await recentlySource.fetchRawSet(makeCtx(), { limit: 3 }, { mode: "keyset", k: "42:id-a" });

    // No `cursor` threaded into the read: the preview never resumes mid-scan.
    expect(media.listActiveRowsKeyset).toHaveBeenCalledWith("u1", { limit: 3 });
  });

  it("returns empty rows when the user has no active rows", async () => {
    vi.mocked(media.listActiveRowsKeyset).mockResolvedValueOnce([]);

    const res = await recentlySource.fetchRawSet(makeCtx(), { limit: 3 }, null);

    expect(res).toEqual({ rows: [], partial: false });
  });
});
