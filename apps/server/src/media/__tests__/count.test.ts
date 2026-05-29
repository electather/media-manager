import type { ConsolaInstance } from "consola";
import type { ActiveRow } from "@ent-mcp/shared/media";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { __resetAvailabilityCache } from "../availability-cache";
import { countBuckets, type CountBucketsContext } from "../service/count";

function row(tmdbId: string): ActiveRow {
  return {
    id: `id-${tmdbId}`,
    userId: "u1",
    tmdbId,
    mediaType: "movie",
    state: "active",
    source: "manual",
    addedAt: 1_700_000_000_000,
    removedAt: null,
    seeded: false,
  };
}

interface Stubs {
  getStatusBatch?: () => Promise<Record<string, string>>;
  getMetadataBatch?: () => Promise<Record<string, { year?: number }>>;
  getMatchingServers?: (tmdbId: string) => Promise<{ id: string; label: string }[]>;
  getContinueWatchingFeed?: () => Promise<{ items: unknown[]; partial: boolean }>;
}

function makeCtx(stubs: Stubs = {}): {
  ctx: CountBucketsContext;
  probe: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
} {
  const status = vi.fn(stubs.getStatusBatch ?? (async () => ({})));
  const probe = vi.fn(stubs.getMatchingServers ?? (async () => []));
  const ctx = {
    userId: "u1",
    mediaService: {
      getStatusBatch: status,
      getMatchingServers: probe,
      getContinueWatchingFeed:
        stubs.getContinueWatchingFeed ?? (async () => ({ items: [], partial: false })),
    },
    catalog: { getMetadataBatch: stubs.getMetadataBatch ?? (async () => ({})) },
    log: { warn: vi.fn() } as unknown as ConsolaInstance,
  } as unknown as CountBucketsContext;
  return { ctx, probe, status };
}

describe("media count-mode countBuckets", () => {
  afterEach(() => {
    // The matching-server cache is process-local; clear it so a probe value
    // warmed by one test cannot shadow the next test's per-tmdb mock.
    __resetAvailabilityCache();
  });

  it("tallies ready / upcoming / unavailable identically to the pre-refactor getCounts loop", async () => {
    // Parity fixture (mirrors watchlist/service getCounts test): 900 is on a
    // library server (ready), 901 has a far-future year (upcoming), 902 falls
    // through to the rev-6 `unavailable` catch-all (no server, no future year,
    // no request status).
    const { ctx } = makeCtx({
      getMatchingServers: async (tmdbId) =>
        tmdbId === "900" ? [{ id: "jellyfin", label: "Jellyfin" }] : [],
      getMetadataBatch: async () => ({
        "movie:901": { year: new Date().getUTCFullYear() + 3 },
      }),
    });

    const counts = await countBuckets([row("900"), row("901"), row("902")], ctx);

    // WHY: the moved classify-count loop must place every row in exactly one of
    // the five buckets, matching the tallies the watchlist copy produced — the
    // consolidation is only behavior-neutral if the bucket routing is byte-equal.
    expect(counts).toEqual({
      ready: 1,
      "in-progress": 0,
      awaiting: 0,
      unavailable: 1,
      upcoming: 1,
    });
  });

  it("counts an in-progress row when continue-watching reports an active position", async () => {
    const { ctx } = makeCtx({
      getMatchingServers: async () => [{ id: "jellyfin", label: "Jellyfin" }],
      getContinueWatchingFeed: async () => ({
        items: [
          {
            progressMs: 600_000,
            item: { type: "movie", durationSec: 6000, ids: { tmdb: "920" } },
          },
        ],
        partial: false,
      }),
    });

    const counts = await countBuckets([row("920"), row("921")], ctx);

    // WHY: active progress wins over a `ready` server match (920 is in-progress,
    // not double-counted as ready); 921 with no progress stays ready.
    expect(counts["in-progress"]).toBe(1);
    expect(counts.ready).toBe(1);
  });

  it("returns an all-zero tally for an empty row set without any plugin work", async () => {
    const { ctx, probe, status } = makeCtx();

    const counts = await countBuckets([], ctx);

    // WHY: an empty watchlist must not pay the status/probe fan-out just to
    // return zeros — this preserves the getCounts empty short-circuit semantics.
    expect(counts).toEqual({
      ready: 0,
      "in-progress": 0,
      awaiting: 0,
      unavailable: 0,
      upcoming: 0,
    });
    expect(probe).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });
});
