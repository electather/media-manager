import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { consola } from "consola";
import type { CanonicalMetadata } from "@ent-mcp/shared/catalog";

vi.mock("../../../media", () => ({
  listAllActiveRows: vi.fn(),
}));

const mediaRepo = await import("../../../media");
const { getSummary, invalidateMoodSummary, __resetMoodCache } = await import("../cluster");

const listAllActiveMock = vi.mocked(mediaRepo.listAllActiveRows);

function row(tmdbId: string, mediaType: "movie" | "tv" = "movie") {
  return {
    userId: "u1",
    id: `${mediaType}:${tmdbId}`,
    tmdbId,
    mediaType,
    addedAt: 0,
    source: "manual" as const,
    state: "active" as const,
    removedAt: null,
    seeded: false,
  };
}

function meta(over: Partial<CanonicalMetadata>): CanonicalMetadata {
  return {
    tmdbId: over.tmdbId ?? "1",
    mediaType: over.mediaType ?? "movie",
    title: "T",
    year: null,
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
    ...over,
  };
}

function makeCatalog(metaMap: Record<string, CanonicalMetadata>) {
  return {
    getMetadataBatch: vi.fn().mockResolvedValue(metaMap),
  } as unknown as Parameters<typeof getSummary>[0]["catalog"];
}

beforeEach(() => {
  __resetMoodCache();
  listAllActiveMock.mockReset();
});

describe("moods/cluster", () => {
  it("returns empty clusters when the user has no active rows", async () => {
    listAllActiveMock.mockResolvedValueOnce([]);
    const summary = await getSummary({
      userId: "u1",
      catalog: makeCatalog({}),
      log: consola.withTag("test"),
    });
    expect(summary).toEqual({ clusters: [] });
  });

  it("omits clusters below MIN_CLUSTER_SIZE", async () => {
    listAllActiveMock.mockResolvedValueOnce([row("1"), row("2")]);
    const catalog = makeCatalog({
      "movie:1": meta({ tmdbId: "1", genres: ["Horror"] }),
      "movie:2": meta({ tmdbId: "2", genres: ["Horror"] }),
    });
    const summary = await getSummary({ userId: "u1", catalog, log: consola.withTag("test") });
    expect(summary.clusters.find((c) => c.moodId === "dark")).toBeUndefined();
  });

  it("aggregates a mood once the threshold is reached", async () => {
    listAllActiveMock.mockResolvedValueOnce([row("1"), row("2"), row("3")]);
    const catalog = makeCatalog({
      "movie:1": meta({ tmdbId: "1", genres: ["Horror"] }),
      "movie:2": meta({ tmdbId: "2", genres: ["Horror"] }),
      "movie:3": meta({ tmdbId: "3", genres: ["Horror"] }),
    });
    const summary = await getSummary({ userId: "u1", catalog, log: consola.withTag("test") });
    expect(summary.clusters.find((c) => c.moodId === "dark")?.count).toBe(3);
  });

  it("serves cached summaries on the second call within the TTL", async () => {
    listAllActiveMock.mockResolvedValueOnce([row("1"), row("2"), row("3")]);
    const catalog = makeCatalog({
      "movie:1": meta({ tmdbId: "1", genres: ["Horror"] }),
      "movie:2": meta({ tmdbId: "2", genres: ["Horror"] }),
      "movie:3": meta({ tmdbId: "3", genres: ["Horror"] }),
    });
    const ctx = { userId: "u1", catalog, log: consola.withTag("test") };
    await getSummary(ctx);
    await getSummary(ctx);
    expect(listAllActiveMock).toHaveBeenCalledTimes(1);
  });

  it("re-derives after invalidateMoodSummary(userId)", async () => {
    listAllActiveMock.mockResolvedValue([row("1"), row("2"), row("3")]);
    const catalog = makeCatalog({
      "movie:1": meta({ tmdbId: "1", genres: ["Horror"] }),
      "movie:2": meta({ tmdbId: "2", genres: ["Horror"] }),
      "movie:3": meta({ tmdbId: "3", genres: ["Horror"] }),
    });
    const ctx = { userId: "u1", catalog, log: consola.withTag("test") };
    await getSummary(ctx);
    invalidateMoodSummary("u1");
    await getSummary(ctx);
    expect(listAllActiveMock).toHaveBeenCalledTimes(2);
  });
});
