import { describe, expect, it, vi } from "vite-plus/test";
import type { HomeLayoutResponse } from "@ent-mcp/shared/home";
import { HttpError } from "../../errors/http-errors";
import { makeRowCtx } from "./row-test-helpers";

vi.mock("../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

vi.mock("../layout-cache");
vi.mock("../hero", () => ({ pickHero: vi.fn() }));
vi.mock("../enrich", () => ({ enrichItems: vi.fn(async (items: unknown[]) => items) }));
vi.mock("../rows", async () => {
  const provider = {
    rowId: "trendingNow",
    kind: "trendingNow" as const,
    titleKey: "home_row_trendingNow_header",
    eligibility: vi.fn().mockResolvedValue(true),
    initialCursor: vi.fn().mockResolvedValue(null),
    fetchPage: vi.fn().mockResolvedValue({ items: [], cursor: null, partial: false }),
  };
  return {
    ROW_PROVIDERS: { trendingNow: provider } as Record<string, typeof provider>,
    ROW_ORDER: ["trendingNow"],
  };
});

const layoutCache = await import("../layout-cache");
const hero = await import("../hero");
const orchestrator = await import("../orchestrator");

function freshLayout(): HomeLayoutResponse {
  return {
    hero: null,
    rows: [{ rowId: "trendingNow", kind: "trendingNow", titleKey: "k", initialCursor: null }],
    generatedAt: 12345,
  };
}

describe("composeLayout cache path", () => {
  it("returns the cached blob when fresh", async () => {
    vi.mocked(layoutCache.read).mockResolvedValueOnce({
      layout: freshLayout(),
      generatedAt: Date.now(),
    });
    vi.mocked(layoutCache.isFresh).mockReturnValueOnce(true);
    const ctx = makeRowCtx();
    const out = await orchestrator.composeLayout(ctx);
    expect(out.rows).toHaveLength(1);
    expect(layoutCache.write).not.toHaveBeenCalled();
  });

  it("falls through and writes back when cache is stale", async () => {
    vi.mocked(layoutCache.read).mockResolvedValueOnce(null);
    vi.mocked(layoutCache.isFresh).mockReturnValueOnce(false);
    vi.mocked(hero.pickHero).mockResolvedValueOnce(null);
    vi.mocked(layoutCache.write).mockResolvedValueOnce(undefined);
    const ctx = makeRowCtx();
    const out = await orchestrator.composeLayout(ctx);
    expect(out.rows).toHaveLength(1);
    // Detached writeback runs after the response — wait one tick.
    await new Promise((resolve) => setImmediate(resolve));
    expect(layoutCache.write).toHaveBeenCalledTimes(1);
  });
});

describe("composeRow", () => {
  it("throws 404 on unknown rowId", async () => {
    const ctx = makeRowCtx();
    await expect(orchestrator.composeRow(ctx, "nope", null)).rejects.toBeInstanceOf(HttpError);
  });

  it("converts AllPluginsFailedError into partial:true empty page", async () => {
    const rows = await import("../rows");
    const { AllPluginsFailedError } = await import("../../media/errors");
    const provider = rows.ROW_PROVIDERS.trendingNow!;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    vi.mocked(provider.eligibility).mockResolvedValueOnce(true);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    vi.mocked(provider.fetchPage).mockRejectedValueOnce(
      new AllPluginsFailedError("watchlist@v1", []),
    );
    const ctx = makeRowCtx();
    const out = await orchestrator.composeRow(ctx, "trendingNow", null);
    expect(out.items).toEqual([]);
    expect(out.partial).toBe(true);
    expect(out.cursor).toBeNull();
  });
});

describe("composeDetails", () => {
  it("cold-fills via mediaService.getMetadata then refetches", async () => {
    const writeMetadata = vi.fn().mockResolvedValue(undefined);
    const getMetadata = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({
      tmdbId: "1",
      mediaType: "movie",
      title: "Cold",
      year: 2024,
      runtimeMinutes: null,
      posterUrl: null,
      backdropUrl: null,
      clearLogoUrl: null,
      overview: null,
      originalLanguage: null,
      genres: null,
      features: null,
      lastRefreshedAt: 0,
      lastAccessedAt: 0,
      createdAt: 0,
    });
    const ctx = makeRowCtx({
      catalog: { getMetadata, writeMetadata } as never,
      mediaService: {
        getMetadata: vi.fn().mockResolvedValue({ title: "Cold", year: 2024 }),
        getDetails: vi.fn().mockResolvedValue({ cast: ["A"] }),
      } as never,
      statusBatch: { get: vi.fn().mockResolvedValue({ "movie:1": "unknown" }) } as never,
    });
    const res = await orchestrator.composeDetails(ctx, "1", "movie");
    expect(writeMetadata).toHaveBeenCalledTimes(1);
    expect(getMetadata).toHaveBeenCalledTimes(2);
    expect(res.summary.title).toBe("Cold");
    expect(res.details).toEqual({ cast: ["A"] });
  });

  it("returns details=null + error on plugin reject", async () => {
    const ctx = makeRowCtx({
      catalog: {
        getMetadata: vi.fn().mockResolvedValue({
          tmdbId: "1",
          mediaType: "movie",
          title: "X",
          year: 2024,
          runtimeMinutes: null,
          posterUrl: null,
          backdropUrl: null,
          clearLogoUrl: null,
          overview: null,
          originalLanguage: null,
          genres: null,
          features: null,
          lastRefreshedAt: 0,
          lastAccessedAt: 0,
          createdAt: 0,
        }),
      } as never,
      mediaService: {
        getDetails: vi
          .fn()
          .mockRejectedValue(Object.assign(new Error("boom"), { name: "AbortError" })),
      } as never,
      statusBatch: { get: vi.fn().mockResolvedValue({ "movie:1": "unknown" }) } as never,
    });
    const res = await orchestrator.composeDetails(ctx, "1", "movie");
    expect(res.details).toBeNull();
    expect(res.error?.code).toBe("plugin.timeout");
  });

  it("throws 404 when cold-fill plugin returns nothing", async () => {
    const ctx = makeRowCtx({
      catalog: {
        getMetadata: vi.fn().mockResolvedValue(null),
        writeMetadata: vi.fn(),
      } as never,
      mediaService: {
        getMetadata: vi.fn().mockResolvedValue(null),
        getDetails: vi.fn(),
      } as never,
      statusBatch: { get: vi.fn().mockResolvedValue({}) } as never,
    });
    await expect(orchestrator.composeDetails(ctx, "1", "movie")).rejects.toBeInstanceOf(HttpError);
  });
});
