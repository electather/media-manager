import { describe, it, expect } from "vite-plus/test";
import { renderMatchReason, renderProfileUpdate } from "../explain";
import type { CandidateFeatures, PreferenceProfile } from "../types";
import { emptyFeatures } from "../types";

function candidate(overrides: Partial<CandidateFeatures> = {}): CandidateFeatures {
  return {
    id: "movie:1",
    type: "movie",
    title: "Sample",
    genres: ["Thriller"],
    keywords: ["neo-noir"],
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
    sampleSize: 20,
    confidence: "medium",
    lastRebuiltAt: 0,
    lastUpdatedAt: 0,
    ...overrides,
  };
}

describe("renderMatchReason", () => {
  it("joins top two contributors with 'and'", () => {
    const out = renderMatchReason([
      { category: "genres", feature: "Thriller", weight: 0.4 },
      { category: "keywords", feature: "unreliable narrator", weight: 0.3 },
    ]);
    expect(out).toBe(
      "Matches your interest in thriller and you tend to like films with unreliable narrator.",
    );
  });

  it("returns null when no contributor clears the 10% threshold", () => {
    expect(renderMatchReason([{ category: "genres", feature: "X", weight: 0 }])).toBeNull();
  });
});

describe("renderProfileUpdate", () => {
  it("reinforces the top feature on a like", () => {
    const p = profile({ features: { ...emptyFeatures(), genres: { Thriller: 1 } } });
    const out = renderProfileUpdate(candidate(), "like", p);
    expect(out).toBe("Reinforces your preference for thriller.");
  });

  it("decreases the top feature on a dislike", () => {
    const p = profile({ features: { ...emptyFeatures(), genres: { Thriller: 1 } } });
    const out = renderProfileUpdate(candidate(), "dislike", p);
    expect(out).toBe("Decreased preference for thriller.");
  });

  it("falls back to neutral language on a note", () => {
    const out = renderProfileUpdate(candidate({ title: "Heat" }), "note", null);
    expect(out).toBe("Noted your feedback on Heat.");
  });
});
