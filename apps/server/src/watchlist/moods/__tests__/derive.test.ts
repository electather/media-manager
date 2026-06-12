import { describe, expect, it } from "vite-plus/test";
import type { CanonicalMetadata } from "@nama/shared/catalog";
import { derive } from "../derive";

function meta(overrides: Partial<CanonicalMetadata>): CanonicalMetadata {
  return {
    tmdbId: "1",
    mediaType: "movie",
    title: "T",
    year: null,
    runtimeMinutes: null,
    posterUrl: null,
    backdropUrl: null,
    clearLogoUrl: null,
    overview: null,
    originalLanguage: null,
    genres: [],
    features: null,
    lastRefreshedAt: 0,
    lastAccessedAt: 0,
    createdAt: 0,
    ...overrides,
  };
}

describe("moods/derive (V.WL3)", () => {
  it("returns an empty array when metadata is missing", () => {
    expect(derive(undefined)).toEqual([]);
  });

  it("returns an empty array when no rule fires", () => {
    expect(derive(meta({ year: 2020, runtimeMinutes: 110 }))).toEqual([]);
  });

  it("tags cozy for short modern family/romance/comedy films", () => {
    const tags = derive(meta({ genres: ["Family"], year: 2010, runtimeMinutes: 90 }));
    expect(tags).toContain("cozy");
  });

  it("tags epic for fantasy/adventure/war or runtime ≥150", () => {
    expect(derive(meta({ genres: ["Adventure"], runtimeMinutes: 100 }))).toContain("epic");
    expect(derive(meta({ genres: [], runtimeMinutes: 160 }))).toContain("epic");
  });

  it("tags throwback for pre-1990 releases", () => {
    expect(derive(meta({ year: 1985 }))).toContain("throwback");
    expect(derive(meta({ year: 1995 }))).not.toContain("throwback");
  });

  it("tags binge only for TV", () => {
    expect(derive(meta({ mediaType: "tv" }))).toContain("binge");
    expect(derive(meta({ mediaType: "movie" }))).not.toContain("binge");
  });

  it("emits multiple tags when several rules match", () => {
    const tags = derive(meta({ genres: ["Comedy"], year: 1985, runtimeMinutes: 90 }));
    expect(tags).toContain("laugh");
    expect(tags).toContain("throwback");
  });

  it("is pure — same input yields identical output", () => {
    const m = meta({ genres: ["Horror"], year: 2015 });
    expect(derive(m)).toEqual(derive(m));
  });
});
