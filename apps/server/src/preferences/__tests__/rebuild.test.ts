import { describe, it, expect, vi } from "vite-plus/test";

vi.mock("../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

const profileWriteMock = vi.fn();
const feedbackLogReadAllMock = vi.fn();

vi.mock("../storage", () => ({
  profileStorage: {
    read: vi.fn(),
    write: (p: unknown) => profileWriteMock(p),
  },
}));

vi.mock("../feedback-log", () => ({
  feedbackLog: {
    readAllForUser: (userId: string) => feedbackLogReadAllMock(userId),
  },
}));

const { rebuildProfile } = await import("../rebuild");
import type { RatingSignal } from "../provider";
import type { CandidateFeatures } from "../types";
import { NullPreferenceDataProvider } from "./helpers";

class FakeProvider extends NullPreferenceDataProvider {
  featureCalls = 0;
  constructor(private readonly features: CandidateFeatures) {
    super();
  }

  async getItemFeatures(): Promise<CandidateFeatures | null> {
    this.featureCalls += 1;
    return this.features;
  }

  override async getAllRatings(): Promise<RatingSignal[]> {
    return [{ tmdbId: "603", mediaType: "movie", rating: 9, ratedAt: Date.now() }];
  }
}

describe("rebuildProfile", () => {
  it("produces a profile when getItemFeatures returns from a cached metadata response", async () => {
    // Regression for the skipCache:true removal in media-provider — rebuild
    // must continue to work when getItemFeatures is served by the dispatcher's
    // metadata cache rather than a fresh upstream fetch.
    profileWriteMock.mockReset();
    feedbackLogReadAllMock.mockResolvedValue([]);

    const cached: CandidateFeatures = {
      id: "movie:603",
      type: "movie",
      title: "The Matrix",
      year: 1999,
      runtime: 136,
      genres: ["Action", "Science Fiction"],
      keywords: ["dystopia", "ai"],
      cast: ["Keanu Reeves"],
      director: "The Wachowskis",
      writers: [],
      creators: [],
      originalLanguage: "en",
    };
    const provider = new FakeProvider(cached);

    const result = await rebuildProfile({ provider }, "u1", "movie");

    // Provider was consulted exactly once for the rated item; the rebuild
    // accepted the cached feature payload and wrote a non-empty profile.
    expect(provider.featureCalls).toBe(1);
    expect(result.sampleSize).toBe(1);
    expect(profileWriteMock).toHaveBeenCalledTimes(1);
    const written = profileWriteMock.mock.calls[0]![0] as { features: { genres: object } };
    expect(Object.keys(written.features.genres).length).toBeGreaterThan(0);
  });
});
