import { describe, it, expect, vi } from "vite-plus/test";
import type { PreferenceProfile } from "@ent-mcp/shared/preferences";
import type { MediaItem } from "@ent-mcp/shared/media";

vi.mock("../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

const profileReadMock = vi.fn();
vi.mock("../internal/profile-storage", () => ({
  profileStorage: {
    read: (...args: unknown[]) => profileReadMock(...args),
    write: vi.fn(),
  },
}));

const { PreferenceEngine } = await import("../internal/engine");
const { emptyFeatures } = await import("../internal/constants");
import type { CandidateFeatures } from "../types";
import { NullPreferenceDataProvider } from "./helpers";

function profile(overrides: Partial<PreferenceProfile> = {}): PreferenceProfile {
  return {
    userId: "u1",
    mediaType: "movie",
    features: { ...emptyFeatures(), genres: { Thriller: 1 } },
    sampleSize: 50,
    confidence: "high",
    lastRebuiltAt: 0,
    lastUpdatedAt: 0,
    ...overrides,
  };
}

function sparseItem(tmdbId: string): MediaItem {
  // No genres/keywords/cast — forces featuresForCandidate to call the
  // provider rather than using the candidate's inline data.
  return {
    id: `movie:${tmdbId}`,
    title: `t-${tmdbId}`,
    year: 2020,
    type: "movie",
    genres: [],
    rating: null,
    overview: "",
    posterUrl: null,
    status: "unknown",
    userRating: null,
    matchReason: null,
  };
}

function richFeatures(tmdbId: string): CandidateFeatures {
  return {
    id: `movie:${tmdbId}`,
    type: "movie",
    title: `t-${tmdbId}`,
    year: 2020,
    runtime: 120,
    genres: ["Thriller"],
    keywords: ["heist"],
    cast: ["Actor"],
    director: "Director",
    writers: [],
    creators: [],
    originalLanguage: "en",
  };
}

class CountingProvider extends NullPreferenceDataProvider {
  calls = 0;
  callsPerId = new Map<string, number>();

  async getItemFeatures(
    _userId: string,
    tmdbId: string,
    _mediaType: "movie" | "tv",
  ): Promise<CandidateFeatures | null> {
    this.calls += 1;
    this.callsPerId.set(tmdbId, (this.callsPerId.get(tmdbId) ?? 0) + 1);
    return richFeatures(tmdbId);
  }
}

describe("PreferenceEngine.explainRanked", () => {
  it("does not re-fetch features the ranker already pulled (one call per item across rank+explain)", async () => {
    profileReadMock.mockResolvedValue(profile());
    const provider = new CountingProvider();
    const engine = new PreferenceEngine({ provider });

    const candidates = [sparseItem("1"), sparseItem("2"), sparseItem("3")];
    const ranked = await engine.rankCandidates("u1", candidates, { mediaType: "movie" });

    // One feature fetch per candidate during ranking — the contract we want
    // to preserve when explainRanked runs next.
    expect(provider.calls).toBe(3);

    for (const entry of ranked) {
      const reason = await engine.explainRanked("u1", entry);
      // Reason rendering may legitimately return null when no profile
      // overlap — we only care that no extra fetch happened.
      expect(typeof reason === "string" || reason === null).toBe(true);
    }

    // Still 3 — explainRanked reused the features threaded onto each entry.
    expect(provider.calls).toBe(3);
    for (const id of ["1", "2", "3"]) {
      expect(provider.callsPerId.get(id)).toBe(1);
    }
  });

  it("populates RankedCandidate.features with the same shape the provider returned", async () => {
    profileReadMock.mockResolvedValue(profile());
    const provider = new CountingProvider();
    const engine = new PreferenceEngine({ provider });

    const ranked = await engine.rankCandidates("u1", [sparseItem("42")], { mediaType: "movie" });
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.features).toEqual(richFeatures("42"));
  });
});
