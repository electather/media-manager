import type { ConsolaInstance } from "consola";
import type { CanonicalMetadata } from "@ent-mcp/shared/catalog";
import type { ActiveRow } from "@ent-mcp/shared/media";
import { keyToId } from "@ent-mcp/shared/watchlist";
import { describe, expect, it, vi } from "vite-plus/test";
import type { MediaSource } from "../source";
import type { PipelineConfig, SourceContext } from "../types";

vi.mock("../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

vi.mock("../../plugin-runtime", async () => {
  const actual =
    await vi.importActual<typeof import("../../plugin-runtime")>("../../plugin-runtime");
  return {
    ...actual,
    capabilityRegistry: { listProviders: () => [] },
  };
});

const { listRows } = await import("../service/list-rows");
const { decode } = await import("../cursor");
const { __resetAvailabilityCache } = await import("../testing");

const CURRENT_YEAR = new Date().getUTCFullYear();

function row(tmdbId: string, addedAt: number): ActiveRow {
  return {
    id: keyToId({ tmdbId, mediaType: "movie" }),
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

function meta(tmdbId: string, year: number): CanonicalMetadata {
  return {
    tmdbId,
    mediaType: "movie",
    title: `Title ${tmdbId}`,
    year,
    runtimeMinutes: null,
    posterUrl: "https://img/p.jpg",
    backdropUrl: "https://img/b.jpg",
    clearLogoUrl: "https://img/l.png",
    overview: null,
    originalLanguage: null,
    genres: null,
    features: null,
    lastRefreshedAt: 0,
    lastAccessedAt: 0,
    createdAt: 0,
  };
}

function metaMapFor(rows: ActiveRow[], year: number): Record<string, CanonicalMetadata> {
  const map: Record<string, CanonicalMetadata> = {};
  for (const r of rows)
    map[keyToId({ tmdbId: r.tmdbId, mediaType: r.mediaType })] = meta(r.tmdbId, year);
  return map;
}

interface Stubs {
  getStatusBatch?: () => Promise<Record<string, string>>;
  getMetadataBatch?: () => Promise<Record<string, CanonicalMetadata>>;
  getMatchingServers?: () => Promise<Array<{ id: string; label: string }>>;
}

function makeCtx(stubs: Stubs = {}) {
  __resetAvailabilityCache();
  const warn = vi.fn();
  const getStatusBatch = vi.fn(stubs.getStatusBatch ?? (async () => ({})));
  const getMetadataBatch = vi.fn(stubs.getMetadataBatch ?? (async () => ({})));
  const getMatchingServers = vi.fn(stubs.getMatchingServers ?? (async () => []));
  const getContinueWatchingFeed = vi.fn(async () => ({ items: [], partial: false }));
  const getMetadata = vi.fn(async () => null);
  const ctx = {
    userId: "u1",
    mediaService: {
      getStatusBatch,
      getMetadataBatch: undefined,
      getMatchingServers,
      getContinueWatchingFeed,
      getMetadata,
    },
    catalog: { getMetadataBatch },
    statusBatch: {} as SourceContext["statusBatch"],
    logger: { warn } as unknown as ConsolaInstance,
  } as unknown as SourceContext;
  return { ctx, getStatusBatch, getMetadataBatch, getMatchingServers, warn };
}

function source<P = void>(over: Partial<MediaSource<P>>): MediaSource<P> {
  return {
    sourceId: "test",
    fetchRawSet: over.fetchRawSet ?? (async () => ({ rows: [], partial: false })),
    stages: over.stages ?? { sort: "recentDesc", cursorMode: "offset" },
  };
}

function cfg(over: Partial<PipelineConfig<void>> = {}): PipelineConfig<void> {
  return {
    params: undefined,
    cursor: null,
    limit: 60,
    ...over,
  };
}

describe("media listRows pipeline", () => {
  it("runs fetchRawSet → batchLoad → enrich → sort → paginate and offset-slices to the limit", async () => {
    const rows = [row("1", 30), row("2", 20), row("3", 10)];
    const { ctx, getStatusBatch, getMetadataBatch } = makeCtx({
      getMetadataBatch: async () => metaMapFor(rows, CURRENT_YEAR - 5),
    });
    const fetchRawSet = vi.fn(async () => ({ rows, partial: false }));
    const src = source({ fetchRawSet, stages: { sort: "recentDesc", cursorMode: "offset" } });

    const page = await listRows(src, cfg({ limit: 2 }), ctx);

    // Wiring: the source got the context/params/cursor; the page is the sliced,
    // sorted, enriched result with an offset cursor for the next window.
    expect(fetchRawSet).toHaveBeenCalledWith(ctx, undefined, null);
    expect(page.items.map((i) => i.tmdbId)).toEqual(["1", "2"]);
    expect(page.items[0]?.title).toBe("Title 1");
    expect(decode(page.cursor ?? "")).toEqual({ mode: "offset", n: 2 });
    expect(page.partial).toBe(false);
    // WHY: the single fan-out lives in batchLoad — enrich consumes its result
    // via prefetchedBatch rather than re-issuing the status/metadata calls, so
    // each is hit exactly once for the whole read.
    expect(getStatusBatch).toHaveBeenCalledTimes(1);
    expect(getMetadataBatch).toHaveBeenCalledTimes(1);
  });

  it("mints the next keyset cursor from the source's hop token", async () => {
    const rows = [row("1", 30), row("2", 20)];
    const { ctx } = makeCtx({ getMetadataBatch: async () => metaMapFor(rows, CURRENT_YEAR - 5) });
    const src = source({
      fetchRawSet: async () => ({ rows, partial: false, nextRaw: "addedAt:20:movie:2" }),
      stages: { sort: "recentDesc", cursorMode: "keyset" },
    });

    const page = await listRows(src, cfg({ limit: 5 }), ctx);

    // The source owns the resume position; paginate mints the cursor from its
    // opaque hop token, never from item content.
    expect(decode(page.cursor ?? "")).toEqual({ mode: "keyset", k: "addedAt:20:movie:2" });
  });

  it("emits cursor:null when a keyset source signals exhaustion (#500)", async () => {
    const rows = [row("1", 30)];
    const { ctx } = makeCtx({ getMetadataBatch: async () => metaMapFor(rows, CURRENT_YEAR - 5) });
    const src = source({
      // No nextRaw → the source exhausted its scan (incl. the empty-streak
      // give-up); the pipeline must not invent a phantom load-more cursor.
      fetchRawSet: async () => ({ rows, partial: false }),
      stages: { sort: "recentDesc", cursorMode: "keyset" },
    });

    const page = await listRows(src, cfg({ limit: 5 }), ctx);

    expect(page.cursor).toBeNull();
  });

  it("propagates partial when the source soft-fails even though sub-loads are clean", async () => {
    const rows = [row("1", 30)];
    const { ctx } = makeCtx({ getMetadataBatch: async () => metaMapFor(rows, CURRENT_YEAR - 5) });
    const src = source({ fetchRawSet: async () => ({ rows, partial: true }) });

    const page = await listRows(src, cfg(), ctx);

    // A degraded feed must surface to the consumer envelope so it can decide
    // include/drop — it cannot be silently swallowed.
    expect(page.partial).toBe(true);
    expect(page.items).toHaveLength(1);
  });

  it("propagates partial and still returns items when a batch sub-load fails", async () => {
    const rows = [row("1", 30)];
    const { ctx, warn } = makeCtx({
      getStatusBatch: async () => {
        throw new Error("status plugins down");
      },
      getMetadataBatch: async () => metaMapFor(rows, CURRENT_YEAR - 5),
    });
    const src = source({ fetchRawSet: async () => ({ rows, partial: false }) });

    const page = await listRows(src, cfg(), ctx);

    // The status leg degrades to an empty map + partial:true; the page still
    // renders from the metadata that resolved.
    expect(warn).toHaveBeenCalled();
    expect(page.partial).toBe(true);
    expect(page.items).toHaveLength(1);
  });

  it("sorts and windows in the pipeline, not in the source (V.MC1)", async () => {
    // The source returns rows out of order and beyond the page size, with no
    // cursor logic of its own.
    const rows = [row("1", 10), row("2", 30), row("3", 20)];
    const { ctx } = makeCtx({ getMetadataBatch: async () => metaMapFor(rows, CURRENT_YEAR - 5) });
    const src = source({
      fetchRawSet: async () => ({ rows, partial: false }),
      stages: { sort: "recentDesc", cursorMode: "offset" },
    });

    const page = await listRows(src, cfg({ limit: 2 }), ctx);

    // WHY: ordering (recentDesc → 30, 20, 10) and windowing (slice to 2 + next
    // cursor) are produced by listRows. The source supplied only a raw,
    // unsorted, unbounded set — proving it carries no sort/slice/cursor logic.
    expect(page.items.map((i) => i.tmdbId)).toEqual(["2", "3"]);
    expect(decode(page.cursor ?? "")).toEqual({ mode: "offset", n: 2 });
  });

  it("classifies and filters by bucket as pipeline stages", async () => {
    const upcoming = row("1", 30);
    const unavailable = row("2", 20);
    const { ctx } = makeCtx({
      getMetadataBatch: async () => ({
        [keyToId({ tmdbId: "1", mediaType: "movie" })]: meta("1", CURRENT_YEAR + 5),
        [keyToId({ tmdbId: "2", mediaType: "movie" })]: meta("2", CURRENT_YEAR - 5),
      }),
    });
    const src = source({
      fetchRawSet: async () => ({ rows: [upcoming, unavailable], partial: false }),
      stages: { classify: true, filter: "bucket", sort: "recentDesc", cursorMode: "offset" },
    });

    const page = await listRows(src, cfg({ bucket: "upcoming" }), ctx);

    // The future-release row classifies "upcoming" and survives; the released,
    // server-less row classifies "unavailable" and is dropped by the filter
    // stage. classify + filter run over the enriched set inside the pipeline.
    expect(page.items.map((i) => i.tmdbId)).toEqual(["1"]);
  });

  it("does not re-filter a preapplied source (mood filtering is source-side)", async () => {
    const rows = [row("1", 30), row("2", 20)];
    const { ctx } = makeCtx({ getMetadataBatch: async () => metaMapFor(rows, CURRENT_YEAR - 5) });
    const src = source({
      // The source already applied the mood predicate in fetchRawSet; the
      // pipeline must not re-derive moods (media cannot import deriveMoods).
      // `preapplied` is the marker for "filter ran source-side" — adding a
      // pipeline-side branch here would silently double-filter.
      fetchRawSet: async () => ({ rows, partial: false }),
      stages: { filter: "preapplied", sort: "recentDesc", cursorMode: "offset" },
    });

    const page = await listRows(src, cfg(), ctx);

    expect(page.items.map((i) => i.tmdbId)).toEqual(["1", "2"]);
  });

  it("uses the enrichRows override and skips the default batchLoad fan-out", async () => {
    // All 12 home rows ride the enrichRows override (their raw rows are catalog
    // feed entries, not persisted ActiveRows). The override must REPLACE the
    // default batchLoad+enrich fan-out — not run alongside it — and its
    // `partial` must propagate to the page. A regression that still ran the
    // default path would double-fetch and could mis-type the feed rows.
    const rows = [row("1", 30)];
    const enrichOverride = vi.fn(async () => ({
      items: [{ id: "movie:1", tmdbId: "1", mediaType: "movie" as const, title: "Overridden" }],
      partial: true,
    }));
    const { ctx, getStatusBatch, getMetadataBatch } = makeCtx();
    const src = source({ fetchRawSet: async () => ({ rows, partial: false }) });

    const page = await listRows(src, cfg(), ctx, enrichOverride);

    expect(enrichOverride).toHaveBeenCalledOnce();
    // The default fan-out (batchLoad → status + metadata) must NOT run.
    expect(getStatusBatch).not.toHaveBeenCalled();
    expect(getMetadataBatch).not.toHaveBeenCalled();
    expect(page.items.map((i) => i.title)).toEqual(["Overridden"]);
    // partial rides through from the override even though fetchRawSet was clean.
    expect(page.partial).toBe(true);
  });
});
