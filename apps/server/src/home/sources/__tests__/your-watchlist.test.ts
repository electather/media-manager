import { consola } from "consola";
import { describe, expect, it, vi } from "vite-plus/test";

// The source reads through the watchlist module boundary; mock it so the test
// stays free of the watchlist (and its `media → db → env`) module graph.
vi.mock("../../../watchlist", () => ({
  listAvailable: vi.fn(),
}));

const { listAvailable } = await import("../../../watchlist");
const { yourWatchlistSource } = await import("../your-watchlist");
const { WATCHLIST_AVAILABLE } = await import("../../__tests__/fixtures/home-layout-scenario");

const listAvailableMock = vi.mocked(listAvailable);

type SourceContext = Parameters<typeof yourWatchlistSource.fetchRawSet>[0];

function makeCtx(): SourceContext {
  return {
    userId: "u1",
    mediaService: {} as SourceContext["mediaService"],
    catalog: {} as SourceContext["catalog"],
    statusBatch: {} as SourceContext["statusBatch"],
    logger: consola.withTag("your-watchlist-source-test"),
  };
}

const idsOf = (rows: Array<{ id: string }>): string[] => rows.map((r) => r.id);

describe("home your-watchlist source", () => {
  it("carries no sort/filter/cursor logic — identity sort, offset mode (V.MC1)", () => {
    expect(yourWatchlistSource.stages).toEqual({ sort: "none", cursorMode: "offset" });
    expect(yourWatchlistSource.stages.classify).toBeUndefined();
    expect(yourWatchlistSource.stages.filter).toBeUndefined();
  });

  it("returns the available titles WITH addedAt/addedSource preserved (§D, US-019 parity)", async () => {
    listAvailableMock.mockResolvedValue(WATCHLIST_AVAILABLE);
    const { rows, partial } = await yourWatchlistSource.fetchRawSet(makeCtx(), undefined, null);
    expect(idsOf(rows)).toEqual(["movie:wl1", "tv:wl2"]);
    // Design §D: the unified shape carries these — the source must NOT strip
    // them (the home row used to). The WHY (Rule 9): a re-introduced strip
    // would fail here.
    expect(rows[0]).toMatchObject({ addedAt: 100, addedSource: "manual" });
    expect(rows[1]).toMatchObject({ addedAt: 200, addedSource: "plugin" });
    expect(partial).toBe(false);
  });

  it("propagates a watchlist soft-failure as partial", async () => {
    listAvailableMock.mockResolvedValue({ items: [], cursor: null, partial: true });
    const { rows, partial } = await yourWatchlistSource.fetchRawSet(makeCtx(), undefined, null);
    expect(rows).toEqual([]);
    expect(partial).toBe(true);
  });
});
