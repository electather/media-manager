import { describe, expect, it, vi } from "vite-plus/test";
import type { CompactMediaItem } from "@ent-mcp/shared/home";
import { fillMissingArtwork } from "../canonical-artwork-fill";
import type { CanonicalMetadata, MetadataKey } from "../../catalog/types";

function buildCanonical(
  key: MetadataKey,
  overrides: Partial<CanonicalMetadata> = {},
): CanonicalMetadata {
  return {
    tmdbId: key.tmdbId,
    mediaType: key.type,
    title: "Title",
    year: 2024,
    runtimeMinutes: 100,
    posterUrl: "https://image.tmdb.org/poster.jpg",
    backdropUrl: "https://image.tmdb.org/backdrop.jpg",
    clearLogoUrl: "https://fanart.tv/logo.png",
    overview: null,
    originalLanguage: "en",
    genres: null,
    features: { keywords: [], cast: [], director: null, writers: [], creators: [] },
    lastRefreshedAt: 0,
    lastAccessedAt: 0,
    createdAt: 0,
    ...overrides,
  };
}

function makeCatalog(rows: Record<string, CanonicalMetadata>) {
  const getMetadataBatch = vi.fn(async (_keys: MetadataKey[]) => rows);
  return { getMetadataBatch };
}

describe("fillMissingArtwork", () => {
  it("fills poster, backdrop, and clearLogo from canonical when missing", async () => {
    const catalog = makeCatalog({
      "movie:550": buildCanonical({ tmdbId: "550", type: "movie" }),
    });
    const items: CompactMediaItem[] = [
      { id: "movie:550", tmdbId: "550", mediaType: "movie", title: "Fight Club" },
    ];

    await fillMissingArtwork(catalog, items);

    expect(items[0]?.poster).toBe("https://image.tmdb.org/poster.jpg");
    expect(items[0]?.backdrop).toBe("https://image.tmdb.org/backdrop.jpg");
    expect(items[0]?.clearLogo).toBe("https://fanart.tv/logo.png");
  });

  it("preserves fields the item already carries", async () => {
    const catalog = makeCatalog({
      "movie:1": buildCanonical({ tmdbId: "1", type: "movie" }),
    });
    const items: CompactMediaItem[] = [
      {
        id: "movie:1",
        tmdbId: "1",
        mediaType: "movie",
        title: "Existing",
        poster: "https://upstream/poster.jpg",
      },
    ];

    await fillMissingArtwork(catalog, items);

    expect(items[0]?.poster).toBe("https://upstream/poster.jpg");
    expect(items[0]?.backdrop).toBe("https://image.tmdb.org/backdrop.jpg");
  });

  it("skips the catalog call entirely when every item is already complete", async () => {
    const catalog = makeCatalog({});
    const items: CompactMediaItem[] = [
      {
        id: "movie:1",
        tmdbId: "1",
        mediaType: "movie",
        title: "Complete",
        poster: "p",
        backdrop: "b",
        clearLogo: "l",
      },
    ];

    await fillMissingArtwork(catalog, items);

    expect(catalog.getMetadataBatch).not.toHaveBeenCalled();
  });

  it("leaves items untouched when canonical has no row for them", async () => {
    const catalog = makeCatalog({});
    const items: CompactMediaItem[] = [
      { id: "movie:404", tmdbId: "404", mediaType: "movie", title: "Cold" },
    ];

    await fillMissingArtwork(catalog, items);

    expect(items[0]?.poster).toBeUndefined();
    expect(items[0]?.backdrop).toBeUndefined();
    expect(items[0]?.clearLogo).toBeUndefined();
  });

  it("dedupes the canonical batch when multiple items share an id", async () => {
    const catalog = makeCatalog({
      "movie:1": buildCanonical({ tmdbId: "1", type: "movie" }),
    });
    const items: CompactMediaItem[] = [
      { id: "movie:1", tmdbId: "1", mediaType: "movie", title: "A" },
      { id: "movie:1", tmdbId: "1", mediaType: "movie", title: "A duplicate" },
    ];

    await fillMissingArtwork(catalog, items);

    expect(catalog.getMetadataBatch).toHaveBeenCalledOnce();
    const firstCall = catalog.getMetadataBatch.mock.calls[0];
    expect(firstCall?.[0]).toHaveLength(1);
  });

  it("does not overwrite a non-empty value with a null canonical column", async () => {
    const catalog = makeCatalog({
      "movie:1": buildCanonical({ tmdbId: "1", type: "movie" }, { clearLogoUrl: null }),
    });
    const items: CompactMediaItem[] = [
      {
        id: "movie:1",
        tmdbId: "1",
        mediaType: "movie",
        title: "T",
        clearLogo: "kept",
      },
    ];

    await fillMissingArtwork(catalog, items);

    expect(items[0]?.clearLogo).toBe("kept");
  });
});
