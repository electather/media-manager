import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
import type { FeedbackRecord } from "@ent-mcp/shared/preferences";

vi.mock("../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

const profileReadMock = vi.fn();
const profileWriteMock = vi.fn();
const feedbackLogReadSinceMock = vi.fn();
const rebuildProfileMock = vi.fn();

vi.mock("../storage", () => ({
  profileStorage: {
    read: (...args: unknown[]) => profileReadMock(...args),
    write: (p: unknown) => profileWriteMock(p),
  },
}));

vi.mock("../feedback-log", () => ({
  feedbackLog: {
    readSince: (userId: string, since: number) => feedbackLogReadSinceMock(userId, since),
  },
}));

vi.mock("../rebuild", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../rebuild")>();
  return {
    ...actual,
    rebuildProfile: (...args: unknown[]) => rebuildProfileMock(...args),
  };
});

const { applyIncrementalUpdate } = await import("../incremental");
import type { CandidateFeatures } from "../types";
import { emptyFeatures } from "../types";
import { NullPreferenceDataProvider } from "./helpers";
import type { StoredPreferenceProfile } from "../storage";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeProfile(
  mediaType: "movie" | "tv" | "combined",
  lastUpdatedAt: number,
): StoredPreferenceProfile {
  return {
    userId: "u1",
    mediaType,
    features: emptyFeatures(),
    sampleSize: 1,
    confidence: "low",
    lastRebuiltAt: lastUpdatedAt,
    lastUpdatedAt,
    version: 1,
  };
}

function makeFeedbackRecord(overrides: Partial<FeedbackRecord> = {}): FeedbackRecord {
  return {
    id: "r1",
    userId: "u1",
    tmdbId: "603",
    mediaType: "movie",
    action: "rate",
    rating: 9,
    note: null,
    noteSentiment: null,
    noteKeywords: null,
    createdAt: 2000,
    ...overrides,
  };
}

const matrixFeatures: CandidateFeatures = {
  id: "movie:603",
  type: "movie",
  title: "The Matrix",
  year: 1999,
  runtime: 136,
  genres: ["Action", "Science Fiction"],
  keywords: ["dystopia"],
  cast: ["Keanu Reeves"],
  director: "The Wachowskis",
  writers: [],
  creators: [],
  originalLanguage: "en",
};

class FakeProvider extends NullPreferenceDataProvider {
  constructor(private readonly features: CandidateFeatures | null = matrixFeatures) {
    super();
  }
  async getItemFeatures(): Promise<CandidateFeatures | null> {
    return this.features;
  }
}

// ─── applyIncrementalUpdate ───────────────────────────────────────────────────

describe("applyIncrementalUpdate", () => {
  const NOW = 5000;

  beforeEach(() => {
    vi.clearAllMocks();
    rebuildProfileMock.mockResolvedValue({ sampleSize: 0 });
    profileWriteMock.mockResolvedValue(undefined);
    feedbackLogReadSinceMock.mockResolvedValue([]);
    // Default: all three partitions exist.
    profileReadMock.mockImplementation((_userId: string, mediaType: string) =>
      Promise.resolve(makeProfile(mediaType as "movie" | "tv" | "combined", 1000)),
    );
  });

  it("bootstraps all three partitions via rebuild when no profile exists", async () => {
    profileReadMock.mockResolvedValue(null);

    const result = await applyIncrementalUpdate({ provider: new FakeProvider() }, "u1", NOW);

    expect(rebuildProfileMock).toHaveBeenCalledTimes(3);
    expect(rebuildProfileMock).toHaveBeenCalledWith(
      expect.objectContaining({ provider: expect.any(Object) }),
      "u1",
      "movie",
      NOW,
    );
    expect(result).toEqual({ userId: "u1", applied: 0 });
  });

  it("returns applied:0 when there are no new feedback records", async () => {
    feedbackLogReadSinceMock.mockResolvedValue([]);

    const result = await applyIncrementalUpdate({ provider: new FakeProvider() }, "u1", NOW);

    expect(result).toEqual({ userId: "u1", applied: 0 });
    // Profiles must not be written when nothing changed.
    expect(profileWriteMock).not.toHaveBeenCalled();
  });

  it("applies a high-rated movie record to the movie and combined partitions", async () => {
    const record = makeFeedbackRecord({ createdAt: 2000, mediaType: "movie" });
    feedbackLogReadSinceMock.mockResolvedValue([record]);

    const result = await applyIncrementalUpdate({ provider: new FakeProvider() }, "u1", NOW);

    // Record matches "movie" and "combined" partitions but not "tv".
    expect(result.applied).toBe(2);
    // All three existing partitions get their timestamps updated.
    expect(profileWriteMock).toHaveBeenCalledTimes(3);
  });

  it("skips a record whose createdAt is not newer than the partition's lastUpdatedAt", async () => {
    // Profile updated at t=2000, record created at exactly t=1000 (older).
    profileReadMock.mockImplementation((_userId: string, mediaType: string) =>
      Promise.resolve(makeProfile(mediaType as "movie" | "tv" | "combined", 2000)),
    );
    const staleRecord = makeFeedbackRecord({ createdAt: 1000 });
    feedbackLogReadSinceMock.mockResolvedValue([staleRecord]);

    const result = await applyIncrementalUpdate({ provider: new FakeProvider() }, "u1", NOW);

    expect(result.applied).toBe(0);
  });

  it("skips a record when getItemFeatures returns null", async () => {
    const record = makeFeedbackRecord({ createdAt: 2000 });
    feedbackLogReadSinceMock.mockResolvedValue([record]);

    const result = await applyIncrementalUpdate({ provider: new FakeProvider(null) }, "u1", NOW);

    expect(result.applied).toBe(0);
  });

  it("does not apply a movie record to the tv partition", async () => {
    const record = makeFeedbackRecord({ createdAt: 2000, mediaType: "movie" });
    feedbackLogReadSinceMock.mockResolvedValue([record]);

    await applyIncrementalUpdate({ provider: new FakeProvider() }, "u1", NOW);

    // Verify genre delta accumulates on the movie partition (not tv).
    const movieProfile = profileWriteMock.mock.calls
      .map((c) => c[0] as StoredPreferenceProfile)
      .find((p) => p.mediaType === "movie");
    expect(movieProfile?.features.genres["Action"]).toBeGreaterThan(0);

    const tvProfile = profileWriteMock.mock.calls
      .map((c) => c[0] as StoredPreferenceProfile)
      .find((p) => p.mediaType === "tv");
    expect(tvProfile?.features.genres["Action"]).toBeUndefined();
  });

  it("updates lastUpdatedAt on all written profiles", async () => {
    const record = makeFeedbackRecord({ createdAt: 2000 });
    feedbackLogReadSinceMock.mockResolvedValue([record]);

    await applyIncrementalUpdate({ provider: new FakeProvider() }, "u1", NOW);

    for (const [writtenProfile] of profileWriteMock.mock.calls) {
      expect((writtenProfile as StoredPreferenceProfile).lastUpdatedAt).toBe(NOW);
    }
  });
});

// ─── recordWeight (via applyIncrementalUpdate) ────────────────────────────────

describe("recordWeight signal mapping", () => {
  const NOW = 9000;

  beforeEach(() => {
    vi.clearAllMocks();
    profileWriteMock.mockResolvedValue(undefined);
    profileReadMock.mockImplementation((_userId: string, mediaType: string) =>
      Promise.resolve(makeProfile(mediaType as "movie" | "tv" | "combined", 1000)),
    );
  });

  async function genreDeltaFor(record: FeedbackRecord): Promise<number> {
    feedbackLogReadSinceMock.mockResolvedValue([record]);
    await applyIncrementalUpdate({ provider: new FakeProvider() }, "u1", NOW);
    const movieProfile = profileWriteMock.mock.calls
      .map((c) => c[0] as StoredPreferenceProfile)
      .find((p) => p.mediaType === "movie");
    return movieProfile?.features.genres["Action"] ?? 0;
  }

  it("applies positive delta for a high rating (≥8)", async () => {
    const delta = await genreDeltaFor(
      makeFeedbackRecord({ action: "rate", rating: 9, createdAt: 2000 }),
    );
    expect(delta).toBeGreaterThan(0);
  });

  it("applies zero delta for a mid rating (4-7)", async () => {
    const delta = await genreDeltaFor(
      makeFeedbackRecord({ action: "rate", rating: 5, createdAt: 2000 }),
    );
    expect(delta).toBe(0);
  });

  it("applies negative delta for a low rating (≤3)", async () => {
    const delta = await genreDeltaFor(
      makeFeedbackRecord({ action: "rate", rating: 2, createdAt: 2000 }),
    );
    expect(delta).toBeLessThan(0);
  });

  it("applies positive delta for a like", async () => {
    const delta = await genreDeltaFor(
      makeFeedbackRecord({ action: "like", rating: null, createdAt: 2000 }),
    );
    expect(delta).toBeGreaterThan(0);
  });

  it("applies negative delta for a dislike", async () => {
    const delta = await genreDeltaFor(
      makeFeedbackRecord({ action: "dislike", rating: null, createdAt: 2000 }),
    );
    expect(delta).toBeLessThan(0);
  });

  it("skips a note record that has zero weight and no keywords", async () => {
    feedbackLogReadSinceMock.mockResolvedValue([
      makeFeedbackRecord({
        action: "note",
        rating: null,
        noteSentiment: "neutral",
        noteKeywords: null,
        createdAt: 2000,
      }),
    ]);
    await applyIncrementalUpdate({ provider: new FakeProvider() }, "u1", NOW);
    // Zero weight + no keywords → nothing applied; profiles still get written
    // (timestamp update) but genre delta stays 0.
    const movieProfile = profileWriteMock.mock.calls
      .map((c) => c[0] as StoredPreferenceProfile)
      .find((p) => p.mediaType === "movie");
    expect(movieProfile?.features.genres["Action"] ?? 0).toBe(0);
  });
});

// ─── applyToProfile (via applyIncrementalUpdate) ──────────────────────────────

describe("applyToProfile feature accumulation", () => {
  const NOW = 7000;

  beforeEach(() => {
    vi.clearAllMocks();
    profileWriteMock.mockResolvedValue(undefined);
    profileReadMock.mockImplementation((_userId: string, mediaType: string) =>
      Promise.resolve(makeProfile(mediaType as "movie" | "tv" | "combined", 1000)),
    );
  });

  it("accumulates note keywords on the keywords bucket when a positive note is present", async () => {
    feedbackLogReadSinceMock.mockResolvedValue([
      makeFeedbackRecord({
        action: "note",
        rating: null,
        noteSentiment: "positive",
        noteKeywords: ["heist", "dystopia"],
        createdAt: 2000,
      }),
    ]);

    await applyIncrementalUpdate({ provider: new FakeProvider() }, "u1", NOW);

    const movieProfile = profileWriteMock.mock.calls
      .map((c) => c[0] as StoredPreferenceProfile)
      .find((p) => p.mediaType === "movie");
    expect(movieProfile?.features.keywords["heist"]).toBeGreaterThan(0);
    expect(movieProfile?.features.keywords["dystopia"]).toBeGreaterThan(0);
  });

  it("increments sampleSize for each applied record", async () => {
    const records = [
      makeFeedbackRecord({ id: "r1", createdAt: 2000 }),
      makeFeedbackRecord({ id: "r2", createdAt: 3000 }),
    ];
    feedbackLogReadSinceMock.mockResolvedValue(records);

    await applyIncrementalUpdate({ provider: new FakeProvider() }, "u1", NOW);

    const movieProfile = profileWriteMock.mock.calls
      .map((c) => c[0] as StoredPreferenceProfile)
      .find((p) => p.mediaType === "movie");
    // Base sampleSize is 1 (from makeProfile) + 2 applied records.
    expect(movieProfile?.sampleSize).toBe(3);
  });

  it("accumulates genre and people deltas together in one pass", async () => {
    feedbackLogReadSinceMock.mockResolvedValue([
      makeFeedbackRecord({ action: "rate", rating: 9, createdAt: 2000 }),
    ]);

    await applyIncrementalUpdate({ provider: new FakeProvider() }, "u1", NOW);

    const movieProfile = profileWriteMock.mock.calls
      .map((c) => c[0] as StoredPreferenceProfile)
      .find((p) => p.mediaType === "movie");
    expect(movieProfile?.features.genres["Action"]).toBeGreaterThan(0);
    expect(movieProfile?.features.people["Director:The Wachowskis"]).toBeGreaterThan(0);
    expect(movieProfile?.features.people["Actor:Keanu Reeves"]).toBeGreaterThan(0);
  });
});
