import { describe, it, expect } from "vite-plus/test";
import type { MediaItem } from "@ent-mcp/shared/media";
import {
  effectiveAlpha,
  normalizeProfile,
  rankCandidatesAgainst,
  resolveEffectiveProfile,
  scoreCandidate,
} from "../scoring";
import type { PreferenceProfile } from "@ent-mcp/shared/preferences";
import type { CandidateFeatures } from "../types";
import { emptyFeatures } from "../types";

function mediaItem(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id: "movie:1",
    title: "Item",
    year: 2020,
    type: "movie",
    genres: [],
    rating: null,
    overview: "",
    posterUrl: null,
    status: "unknown",
    userRating: null,
    matchReason: null,
    ...overrides,
  };
}

function candidate(overrides: Partial<CandidateFeatures> = {}): CandidateFeatures {
  return {
    id: "movie:1",
    type: "movie",
    genres: [],
    keywords: [],
    cast: [],
    director: null,
    writers: [],
    creators: [],
    originalLanguage: null,
    ...overrides,
  };
}

function profile(overrides: Partial<PreferenceProfile> = {}): PreferenceProfile {
  return {
    userId: "u",
    mediaType: "movie",
    features: emptyFeatures(),
    sampleSize: 50,
    confidence: "high",
    lastRebuiltAt: 0,
    lastUpdatedAt: 0,
    ...overrides,
  };
}

describe("scoreCandidate", () => {
  it("sums category-weighted overlap and sorts contributors descending", () => {
    const p = profile({
      features: { ...emptyFeatures(), genres: { Thriller: 0.4, Crime: 0.1 } },
    });
    const { profileScore, contributors } = scoreCandidate(
      candidate({ genres: ["Thriller", "Crime"] }),
      p,
    );
    expect(profileScore).toBeCloseTo(0.3 * 0.4 + 0.3 * 0.1, 5);
    expect(contributors[0]!.feature).toBe("Thriller");
    expect(contributors[1]!.feature).toBe("Crime");
  });

  it("returns zero when the profile has no overlapping features", () => {
    const p = profile({ features: { ...emptyFeatures(), genres: { Drama: 1 } } });
    const { profileScore } = scoreCandidate(candidate({ genres: ["Thriller"] }), p);
    expect(profileScore).toBe(0);
  });
});

describe("rankCandidatesAgainst", () => {
  const makeEntries = (specs: Array<{ id: string; genres: string[] }>) =>
    specs.map((spec) => ({
      item: mediaItem({ id: spec.id, genres: spec.genres }),
      features: candidate({ id: spec.id, genres: spec.genres }),
    }));

  it("orders candidates by blended score with a high-confidence profile", () => {
    const p = profile({
      features: { ...emptyFeatures(), genres: { Thriller: 1 } },
    });
    const results = rankCandidatesAgainst(
      makeEntries([
        { id: "movie:1", genres: ["Drama"] },
        { id: "movie:2", genres: ["Thriller"] },
      ]),
      p,
    );
    expect(results[0]!.item.id).toBe("movie:2");
  });

  it("is stable with empty profile — original order preserved", () => {
    const results = rankCandidatesAgainst(
      makeEntries([
        { id: "a", genres: ["X"] },
        { id: "b", genres: ["X"] },
      ]),
      null,
    );
    expect(results.map((r) => r.item.id)).toEqual(["a", "b"]);
  });

  it("returns low confidence when profile is thin", () => {
    const p = profile({ sampleSize: 5, confidence: "low" });
    const results = rankCandidatesAgainst(makeEntries([{ id: "x", genres: [] }]), p);
    expect(results[0]!.confidence).toBe("low");
  });
});

describe("effectiveAlpha", () => {
  it("clamps thin profiles to the minimum alpha", () => {
    expect(effectiveAlpha(0)).toBe(0.3);
  });
  it("ramps linearly to the requested alpha at the threshold", () => {
    expect(effectiveAlpha(15)).toBe(0.7);
  });
});

describe("resolveEffectiveProfile", () => {
  const typed = profile({ mediaType: "movie", sampleSize: 50 });
  const combined = profile({ mediaType: "combined", sampleSize: 100 });

  it("returns the typed profile when it has enough signal", () => {
    expect(resolveEffectiveProfile(typed, combined).profile).toBe(typed);
  });
  it("falls back to combined when the typed profile is thin", () => {
    const thin = profile({ mediaType: "movie", sampleSize: 5 });
    expect(resolveEffectiveProfile(thin, combined).profile).toBe(combined);
  });
  it("returns a thin typed profile when both are thin", () => {
    const thin = profile({ mediaType: "movie", sampleSize: 1 });
    const thinCombined = profile({ mediaType: "combined", sampleSize: 2 });
    expect(resolveEffectiveProfile(thin, thinCombined).profile).toBe(thin);
  });
});

describe("normalizeProfile", () => {
  it("rescales category totals so abs-weights sum to 1", () => {
    const f = { ...emptyFeatures(), genres: { A: 2, B: 2 } };
    const normalized = normalizeProfile(f);
    expect(normalized.genres.A).toBeCloseTo(0.5, 6);
    expect(normalized.genres.B).toBeCloseTo(0.5, 6);
  });
});
