import { consola } from "consola";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ActiveRow, MediaRowBucket } from "@nama/shared/media";
import type { SourceContext } from "../../../media";

type ClassifiedRow = { row: ActiveRow; bucket: MediaRowBucket };

// Mock the media barrel minimally so the test stays env/db-free (the real
// barrel drags `db/client` → `env`). `classifyRows` is the shared classify pass
// (its own tests + the section parity test cover real classification); here we
// stub it to drive `fetchRawSet`'s candidate FILTER — the source's only job.
vi.mock("../../../media", () => ({
  listAllActiveRows: vi.fn(async () => [] as ActiveRow[]),
  classifyRows: vi.fn(async () => ({ classified: [] as ClassifiedRow[], partial: false })),
}));

const media = await import("../../../media");
const { tonightSource, tonightCfg, TONIGHT_PAGE_LIMIT } = await import("../tonight");

function row(tmdbId: string): ActiveRow {
  return {
    id: `id-${tmdbId}`,
    userId: "u1",
    tmdbId,
    mediaType: "movie",
    state: "active",
    source: "manual",
    addedAt: 1,
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
    logger: consola.withTag("tonight-test"),
  };
}

beforeEach(() => {
  vi.mocked(media.listAllActiveRows).mockReset().mockResolvedValue([]);
  vi.mocked(media.classifyRows).mockReset().mockResolvedValue({ classified: [], partial: false });
});

// The tonight source declares the pipeline stages and runs the cheap classify
// pre-filter (design §S.2). If the stages routing or the bucket pre-filter
// regresses, tonight would enrich the wrong pool (or the whole backlog).
describe("tonightSource.stages (design §S.2)", () => {
  it("declares an unsorted, bounded (no-cursor) page — pick orders in the envelope", () => {
    expect(tonightSource.stages).toEqual({ sort: "none", cursorMode: "keyset" });
  });

  it("tonightCfg is the whole bounded candidate set with no cursor", () => {
    expect(tonightCfg()).toEqual({ params: undefined, cursor: null, limit: TONIGHT_PAGE_LIMIT });
  });
});

describe("tonightSource.fetchRawSet (V.MC1 — RAW candidate rows only)", () => {
  it("returns empty without classifying when the user has no active rows", async () => {
    vi.mocked(media.listAllActiveRows).mockResolvedValueOnce([]);

    const res = await tonightSource.fetchRawSet(makeCtx(), undefined, null);

    expect(res).toEqual({ rows: [], partial: false });
    expect(media.classifyRows).not.toHaveBeenCalled();
  });

  it("keeps only the ready + in-progress rows (raw), dropping the rest, in order", async () => {
    const buckets: [string, MediaRowBucket][] = [
      ["ready", "ready"],
      ["inprog", "in-progress"],
      ["unavail", "unavailable"],
      ["upcoming", "upcoming"],
      ["awaiting", "awaiting"],
    ];
    const rows = buckets.map(([t]) => row(t));
    vi.mocked(media.listAllActiveRows).mockResolvedValueOnce(rows);
    vi.mocked(media.classifyRows).mockResolvedValueOnce({
      classified: buckets.map(([t, bucket]) => ({ row: row(t), bucket })),
      partial: false,
    });

    const res = await tonightSource.fetchRawSet(makeCtx(), undefined, null);

    // RAW rows (not enriched), classify order preserved — `pick` re-sorts downstream.
    expect(res.rows.map((r) => r.tmdbId)).toEqual(["ready", "inprog"]);
    expect(res.partial).toBe(false);
  });

  it("swallows the classify pass's `partial` (pre-filter degrade never fails the section)", async () => {
    vi.mocked(media.listAllActiveRows).mockResolvedValueOnce([row("ready")]);
    vi.mocked(media.classifyRows).mockResolvedValueOnce({
      classified: [{ row: row("ready"), bucket: "ready" }],
      partial: true,
    });

    const res = await tonightSource.fetchRawSet(makeCtx(), undefined, null);

    expect(res).toEqual({ rows: [expect.objectContaining({ tmdbId: "ready" })], partial: false });
  });
});
