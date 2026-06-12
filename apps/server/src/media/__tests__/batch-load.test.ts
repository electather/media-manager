import type { ConsolaInstance } from "consola";
import type { ActiveRow } from "@nama/shared/media";
import { describe, expect, it, vi } from "vite-plus/test";
import { batchLoad, type BatchLoadContext } from "../pipeline/batch-load";

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
  getContinueWatchingFeed?: () => Promise<{ items: unknown[]; partial: boolean }>;
}

function makeCtx(stubs: Stubs = {}): { ctx: BatchLoadContext; warn: ReturnType<typeof vi.fn> } {
  const warn = vi.fn();
  const ctx = {
    mediaService: {
      getStatusBatch: stubs.getStatusBatch ?? (async () => ({})),
      getContinueWatchingFeed:
        stubs.getContinueWatchingFeed ?? (async () => ({ items: [], partial: false })),
    },
    catalog: { getMetadataBatch: stubs.getMetadataBatch ?? (async () => ({})) },
    log: { warn } as unknown as ConsolaInstance,
  } as unknown as BatchLoadContext;
  return { ctx, warn };
}

describe("media pipeline batchLoad", () => {
  it("merges status + metadata + progress and reports partial:false when every sub-load resolves", async () => {
    const { ctx, warn } = makeCtx({
      getStatusBatch: async () => ({ "movie:1": "available" }),
      getMetadataBatch: async () => ({ "movie:1": { year: 1999 } }),
      getContinueWatchingFeed: async () => ({ items: [], partial: false }),
    });

    const result = await batchLoad([row("1")], ctx);

    // A clean fan-out must not warn and must not flag the read as degraded —
    // otherwise the consumer envelope would mark a healthy page `partial`.
    expect(warn).not.toHaveBeenCalled();
    expect(result.partial).toBe(false);
    expect(result.statuses).toEqual({ "movie:1": "available" });
    expect(result.metadata).toEqual({ "movie:1": { year: 1999 } });
  });

  it("warns, blanks only the failed status sub-load, and flags partial when getStatusBatch rejects", async () => {
    const { ctx, warn } = makeCtx({
      getStatusBatch: async () => {
        throw new Error("status plugins down");
      },
      getMetadataBatch: async () => ({ "movie:1": { year: 1999 } }),
    });

    const result = await batchLoad([row("1")], ctx);

    // WHY: a soft status failure must degrade gracefully — log it, fall back to
    // an empty status map, and set `partial` so the consumer can surface the
    // degraded read. Critically it must NOT blank the metadata that DID resolve;
    // one failed sub-load cannot sink the siblings that succeeded.
    expect(warn).toHaveBeenCalledOnce();
    expect(result.partial).toBe(true);
    expect(result.statuses).toEqual({});
    expect(result.metadata).toEqual({ "movie:1": { year: 1999 } });
  });

  it("warns, blanks only the failed metadata sub-load, and flags partial when getMetadataBatch rejects", async () => {
    const { ctx, warn } = makeCtx({
      getStatusBatch: async () => ({ "movie:1": "available" }),
      getMetadataBatch: async () => {
        throw new Error("catalog down");
      },
    });

    const result = await batchLoad([row("1")], ctx);

    // Mirror of the status case for the metadata leg: the resolved status survives.
    expect(warn).toHaveBeenCalledOnce();
    expect(result.partial).toBe(true);
    expect(result.metadata).toEqual({});
    expect(result.statuses).toEqual({ "movie:1": "available" });
  });

  it("propagates partial from a failed continue-watching feed (progress sub-load)", async () => {
    const { ctx } = makeCtx({
      getStatusBatch: async () => ({ "movie:1": "available" }),
      getContinueWatchingFeed: async () => {
        throw new Error("cw feed down");
      },
    });

    const result = await batchLoad([row("1")], ctx);

    // The progress leg routes through `loadProgressMap`, which itself
    // warn-and-falls-back to an empty map + partial:true; batchLoad must fold
    // that `partial` up so a missing continue-watching signal degrades rather
    // than silently looking complete.
    expect(result.partial).toBe(true);
    expect(result.progress.size).toBe(0);
  });

  it("short-circuits on empty rows without issuing any sub-load call", async () => {
    const getStatusBatch = vi.fn(async () => ({}));
    const getMetadataBatch = vi.fn(async () => ({}));
    const getContinueWatchingFeed = vi.fn(async () => ({ items: [], partial: false }));
    const { ctx } = makeCtx({ getStatusBatch, getMetadataBatch, getContinueWatchingFeed });

    const result = await batchLoad([], ctx);

    // No rows means no ids to fan out on, so we must not pay the three
    // round-trips (notably the rows-independent continue-watching fetch) just
    // to return three empty maps.
    expect(getStatusBatch).not.toHaveBeenCalled();
    expect(getMetadataBatch).not.toHaveBeenCalled();
    expect(getContinueWatchingFeed).not.toHaveBeenCalled();
    expect(result).toEqual({ statuses: {}, metadata: {}, progress: new Map(), partial: false });
  });
});
