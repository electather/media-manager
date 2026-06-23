import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { consola } from "consola";
import type { CanonicalMetadata } from "@nama/shared/catalog";

vi.mock("../../../media", () => ({
  listAllActiveRows: vi.fn(),
  batchLoad: vi.fn(),
}));

const mediaRepo = await import("../../../media");
const { getSummary, invalidateMoodSummary, __resetMoodCache } = await import("../cluster");

const listAllActiveMock = vi.mocked(mediaRepo.listAllActiveRows);
const batchLoadMock = vi.mocked(mediaRepo.batchLoad);

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

// Fetch now routed through media's shared `batchLoad` (US-012 / design §G),
// so test mocks batchLoad instead of watchlist-local `getMetadataBatch`.
function setMetadata(metaMap: Record<string, CanonicalMetadata>) {
  batchLoadMock.mockResolvedValue({
    statuses: {},
    metadata: metaMap,
    progress: new Map(),
    partial: false,
  });
}

function ctx() {
  return {
    userId: "u1",
    mediaService: {},
    catalog: {},
    log: consola.withTag("test"),
  } as unknown as Parameters<typeof getSummary>[0];
}

beforeEach(async () => {
  await __resetMoodCache();
  listAllActiveMock.mockReset();
  batchLoadMock.mockReset();
});

describe("moods/cluster", () => {
  it("returns empty clusters when the user has no active rows", async () => {
    listAllActiveMock.mockResolvedValueOnce([]);
    const summary = await getSummary(ctx());
    expect(summary).toEqual({ clusters: [] });
    // Empty watchlist short-circuits before any fan-out.
    expect(batchLoadMock).not.toHaveBeenCalled();
  });

  it("omits clusters below MIN_CLUSTER_SIZE", async () => {
    listAllActiveMock.mockResolvedValueOnce([row("1"), row("2")]);
    setMetadata({
      "movie:1": meta({ tmdbId: "1", genres: ["Horror"] }),
      "movie:2": meta({ tmdbId: "2", genres: ["Horror"] }),
    });
    const summary = await getSummary(ctx());
    expect(summary.clusters.find((c) => c.moodId === "dark")).toBeUndefined();
  });

  it("aggregates a mood once the threshold is reached", async () => {
    listAllActiveMock.mockResolvedValueOnce([row("1"), row("2"), row("3")]);
    setMetadata({
      "movie:1": meta({ tmdbId: "1", genres: ["Horror"] }),
      "movie:2": meta({ tmdbId: "2", genres: ["Horror"] }),
      "movie:3": meta({ tmdbId: "3", genres: ["Horror"] }),
    });
    const summary = await getSummary(ctx());
    expect(summary.clusters.find((c) => c.moodId === "dark")?.count).toBe(3);
  });

  it("loads metadata through the shared batchLoad fan-out exactly once", async () => {
    const rows = [row("1"), row("2"), row("3")];
    listAllActiveMock.mockResolvedValueOnce(rows);
    setMetadata({
      "movie:1": meta({ tmdbId: "1", genres: ["Horror"] }),
      "movie:2": meta({ tmdbId: "2", genres: ["Horror"] }),
      "movie:3": meta({ tmdbId: "3", genres: ["Horror"] }),
    });
    await getSummary(ctx());
    // The single shared fan-out replaces the watchlist-local metadata batch.
    expect(batchLoadMock).toHaveBeenCalledTimes(1);
    expect(batchLoadMock).toHaveBeenCalledWith(rows, expect.objectContaining({ userId: "u1" }));
  });

  it("serves cached summaries on the second call within the TTL", async () => {
    listAllActiveMock.mockResolvedValueOnce([row("1"), row("2"), row("3")]);
    setMetadata({
      "movie:1": meta({ tmdbId: "1", genres: ["Horror"] }),
      "movie:2": meta({ tmdbId: "2", genres: ["Horror"] }),
      "movie:3": meta({ tmdbId: "3", genres: ["Horror"] }),
    });
    await getSummary(ctx());
    await getSummary(ctx());
    expect(listAllActiveMock).toHaveBeenCalledTimes(1);
  });

  it("re-derives after invalidateMoodSummary(userId)", async () => {
    listAllActiveMock.mockResolvedValue([row("1"), row("2"), row("3")]);
    setMetadata({
      "movie:1": meta({ tmdbId: "1", genres: ["Horror"] }),
      "movie:2": meta({ tmdbId: "2", genres: ["Horror"] }),
      "movie:3": meta({ tmdbId: "3", genres: ["Horror"] }),
    });
    await getSummary(ctx());
    await invalidateMoodSummary("u1");
    await getSummary(ctx());
    expect(listAllActiveMock).toHaveBeenCalledTimes(2);
  });
});
