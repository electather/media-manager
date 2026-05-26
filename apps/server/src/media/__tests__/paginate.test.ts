import type { ConsolaInstance } from "consola";
import type { CompactMediaItem } from "@ent-mcp/shared/home";
import { describe, expect, it, vi } from "vite-plus/test";
import { decode } from "../cursor";
import { OFFSET_FULL_LOAD_WARN_ROWS, paginate, type PaginateInput } from "../pipeline/paginate";

function item(n: number): CompactMediaItem {
  return { id: `movie:${n}`, tmdbId: String(n), mediaType: "movie", title: `t${n}` };
}

function items(count: number): CompactMediaItem[] {
  return Array.from({ length: count }, (_, i) => item(i));
}

function ids(result: { items: CompactMediaItem[] }): string[] {
  return result.items.map((i) => i.id);
}

describe("media pipeline paginate — keyset mode", () => {
  it("mints the next keyset cursor from the source's hop token and slices to limit", () => {
    const result = paginate({
      items: items(15),
      cursorMode: "keyset",
      cursor: null,
      nextRaw: "1700:movie:9",
      limit: 10,
    });

    // The source overshot (15 rows) but the page must honour `limit`; the
    // resume position is the source's opaque hop token, threaded into `k` so
    // no source needs its own codec (design §E).
    expect(result.items).toHaveLength(10);
    expect(ids(result)).toEqual(items(10).map((i) => i.id));
    expect(result.cursor).not.toBeNull();
    expect(decode(result.cursor!)).toEqual({ mode: "keyset", k: "1700:movie:9" });
  });

  it("returns cursor:null when the source exhausts its scan with no matches (#500 empty-streak)", () => {
    const result = paginate({
      items: [],
      cursorMode: "keyset",
      cursor: null,
      // The source ran its empty-streak hop budget and gave up without
      // collecting a single matching row, so it omits `nextRaw`.
      nextRaw: undefined,
      limit: 10,
    });

    // WHY (#500 / V.PG1): an empty page with no more rows to scan must NOT
    // emit a cursor. A phantom cursor would make the client render a
    // load-more affordance that fetches nothing — the exact regression #500
    // fixed. Exhaustion is the source's call, signalled by a missing token.
    expect(result.items).toEqual([]);
    expect(result.cursor).toBeNull();
  });

  it("returns cursor:null when the source is exhausted even though items were collected", () => {
    const result = paginate({
      items: items(3),
      cursorMode: "keyset",
      cursor: null,
      nextRaw: undefined,
      limit: 10,
    });

    // A final, underfilled page (source scanned to the end) carries the last
    // items but no cursor — there is nothing left to hop to.
    expect(ids(result)).toEqual(["movie:0", "movie:1", "movie:2"]);
    expect(result.cursor).toBeNull();
  });
});

describe("media pipeline paginate — offset mode", () => {
  it("slices the first window from a null cursor and emits the next offset", () => {
    const result = paginate({ items: items(25), cursorMode: "offset", cursor: null, limit: 10 });

    expect(ids(result)).toEqual(items(10).map((i) => i.id));
    expect(result.cursor).not.toBeNull();
    expect(decode(result.cursor!)).toEqual({ mode: "offset", n: 10 });
  });

  it("resumes from an incoming offset cursor and pages through the whole set", () => {
    const all = items(25);
    const second = paginate({
      items: all,
      cursorMode: "offset",
      cursor: { mode: "offset", n: 10 },
      limit: 10,
    });
    expect(second.items.map((i) => i.id)).toEqual(all.slice(10, 20).map((i) => i.id));
    expect(decode(second.cursor!)).toEqual({ mode: "offset", n: 20 });

    const third = paginate({
      items: all,
      cursorMode: "offset",
      cursor: { mode: "offset", n: 20 },
      limit: 10,
    });
    // Final partial page (5 left): the slice exhausts the set, so no cursor.
    expect(third.items.map((i) => i.id)).toEqual(all.slice(20, 25).map((i) => i.id));
    expect(third.cursor).toBeNull();
  });

  it("fills the page from the whole sorted tail for a sparse filtered set (#501)", () => {
    // By the time paginate runs, the `filter` stage has already pruned the set
    // over the FULL sorted list — here three matches that the old code's
    // bounded `limit * OVERSHOOT` window could have stranded. paginate slices
    // the full provided set in a single pass, so every match surfaces on page
    // one with no phantom cursor.
    const sparse = [item(3), item(15), item(18)];
    const result = paginate({ items: sparse, cursorMode: "offset", cursor: null, limit: 10 });

    // WHY (#501 / V.PG1): a sparse bucket+sort page must return min(limit,
    // available) matches in one pass, not truncate to an overshoot window.
    expect(ids(result)).toEqual(["movie:3", "movie:15", "movie:18"]);
    expect(result.cursor).toBeNull();
  });

  it("emits no cursor when the incoming offset is at or past the end", () => {
    const result = paginate({
      items: items(5),
      cursorMode: "offset",
      cursor: { mode: "offset", n: 5 },
      limit: 10,
    });
    expect(result.items).toEqual([]);
    expect(result.cursor).toBeNull();
  });

  it("warns past the RISK-005 advisory row ceiling and stays silent at or below it", () => {
    const warn = vi.fn();
    const log = { warn } as unknown as ConsolaInstance;

    const atCeiling: PaginateInput = {
      items: items(OFFSET_FULL_LOAD_WARN_ROWS),
      cursorMode: "offset",
      cursor: null,
      limit: 10,
      log,
    };
    paginate(atCeiling);
    // The ceiling is inclusive: exactly the threshold must not warn.
    expect(warn).not.toHaveBeenCalled();

    paginate({ ...atCeiling, items: items(OFFSET_FULL_LOAD_WARN_ROWS + 1) });
    // One row over the advisory ceiling surfaces the RISK-005 latency
    // trade-off; rows are still served (the limit is advisory, not a cap).
    expect(warn).toHaveBeenCalledOnce();
  });

  it("does not require a logger to paginate a large offset set", () => {
    // The RISK-005 warn is best-effort; a missing logger must never throw.
    expect(() =>
      paginate({
        items: items(OFFSET_FULL_LOAD_WARN_ROWS + 1),
        cursorMode: "offset",
        cursor: null,
        limit: 10,
      }),
    ).not.toThrow();
  });
});
