import { describe, expect, it, vi } from "vite-plus/test";
import { makeRowCtx } from "./row-test-helpers";
import type { CanonicalMetadata } from "@ent-mcp/shared/catalog";

vi.mock("../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

vi.mock("../../artwork", () => ({
  ArtworkService: class {
    async getArtwork() {
      return { results: {}, generatedAt: 0 };
    }
  },
}));

vi.mock("../../plugin-runtime", async () => {
  const actual =
    await vi.importActual<typeof import("../../plugin-runtime")>("../../plugin-runtime");
  return {
    ...actual,
    capabilityRegistry: { listProviders: () => [] },
  };
});

const { enrichItems } = await import("../internal/enrich");

function meta(overrides: Partial<CanonicalMetadata>): CanonicalMetadata {
  return {
    tmdbId: "1",
    mediaType: "movie",
    title: "T",
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
    ...overrides,
  };
}

describe("enrichItems mergeArtwork", () => {
  it("applies canonical metadata artwork when bundle is undefined", async () => {
    // Reproduces the hero/CW image bug: an adapter that emits items without
    // poster/backdrop relied on `mergeArtwork` to fill them from the catalog
    // metadata pass. The previous implementation early-returned when the
    // dispatch bundle was empty (catalog already complete → no request sent),
    // leaving the wire item with null images even though canonical art existed.
    const catalogMeta = meta({
      tmdbId: "1",
      posterUrl: "https://img/poster.jpg",
      backdropUrl: "https://img/backdrop.jpg",
      clearLogoUrl: "https://img/logo.png",
    });
    const ctx = makeRowCtx({
      catalog: {
        getMetadataBatch: vi.fn().mockResolvedValue({ "movie:1": catalogMeta }),
      } as never,
      statusBatch: { get: vi.fn().mockResolvedValue({}) } as never,
    });
    const out = await enrichItems(
      [{ id: "movie:1", tmdbId: "1", mediaType: "movie", title: "T" }],
      ctx,
      { rowId: "hero" },
    );
    expect(out[0]?.poster).toBe("https://img/poster.jpg");
    expect(out[0]?.backdrop).toBe("https://img/backdrop.jpg");
    expect(out[0]?.clearLogo).toBe("https://img/logo.png");
  });

  it("keeps adapter-supplied artwork untouched", async () => {
    const ctx = makeRowCtx({
      catalog: {
        getMetadataBatch: vi.fn().mockResolvedValue({
          "movie:1": meta({ posterUrl: "https://catalog/poster.jpg" }),
        }),
      } as never,
      statusBatch: { get: vi.fn().mockResolvedValue({}) } as never,
    });
    const out = await enrichItems(
      [
        {
          id: "movie:1",
          tmdbId: "1",
          mediaType: "movie",
          title: "T",
          poster: "https://upstream/poster.jpg",
        },
      ],
      ctx,
      { rowId: "hero" },
    );
    expect(out[0]?.poster).toBe("https://upstream/poster.jpg");
  });
});
