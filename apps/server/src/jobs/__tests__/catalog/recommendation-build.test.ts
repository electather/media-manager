import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { consola } from "consola";

vi.mock("../../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

const getRecommendationsFeedMock = vi.fn();
class FakeMediaService {
  async getRecommendationsFeed(...args: unknown[]) {
    return getRecommendationsFeedMock(...args);
  }
}
vi.mock("../../../media/service", () => ({ MediaService: FakeMediaService }));

const rankCandidatesMock = vi.fn();
const explainRankedMock = vi.fn();
const rebuildProfileMock = vi.fn();
vi.mock("../../../preferences", () => ({
  getPreferenceEngine: () => ({
    rankCandidates: (...args: unknown[]) => rankCandidatesMock(...args),
    explainRanked: (...args: unknown[]) => explainRankedMock(...args),
    rebuildProfile: (...args: unknown[]) => rebuildProfileMock(...args),
  }),
}));

const profileReadMock = vi.fn();
vi.mock("../../../preferences/storage", () => ({
  profileStorage: {
    read: (...args: unknown[]) => profileReadMock(...args),
  },
}));

const { cleanupInMemoryDbs, createInMemoryDb } =
  await import("../../../__tests__/helpers/in-memory-db");
const { user } = await import("../../../db/schema/auth");
const { CatalogService } = await import("../../../catalog/service");
const { writeRecommendationsForUser } = await import("../../../catalog/jobs/recommendation-build");

afterAll(() => cleanupInMemoryDbs());

beforeEach(() => {
  getRecommendationsFeedMock.mockReset();
  rankCandidatesMock.mockReset();
  explainRankedMock.mockReset();
  rebuildProfileMock.mockReset();
  profileReadMock.mockReset();
});

async function setup() {
  const db = await createInMemoryDb();
  await db.insert(user).values({
    id: "u1",
    name: "u1",
    email: "u1@test",
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return { db, catalog: new CatalogService(db) };
}

describe("writeRecommendationsForUser", () => {
  it("writes the top-N rec list with the current combined profile_version", async () => {
    const { catalog } = await setup();
    getRecommendationsFeedMock.mockResolvedValue({
      items: [
        { id: "movie:1", type: "movie", title: "One", ids: { tmdb_id: "1" } },
        { id: "movie:2", type: "movie", title: "Two", ids: { tmdb_id: "2" } },
      ],
      partial: false,
    });
    rankCandidatesMock.mockResolvedValue([
      {
        item: { id: "movie:1", type: "movie", title: "One" },
        score: 0.91,
        features: {},
        topContributors: [],
      },
      {
        item: { id: "movie:2", type: "movie", title: "Two" },
        score: 0.71,
        features: {},
        topContributors: [],
      },
    ]);
    explainRankedMock.mockResolvedValueOnce("noir mood").mockResolvedValueOnce(null);
    profileReadMock.mockResolvedValue({ version: 5 });

    const ctrl = new AbortController();
    await writeRecommendationsForUser({ catalog }, "u1", ctrl.signal);

    const fetched = await catalog.getRecommendations("u1");
    expect(fetched?.profileVersion).toBe(5);
    expect(fetched?.items.map((i) => i.tmdbId)).toEqual(["1", "2"]);
    expect(fetched?.items[0]?.matchReason).toBe("noir mood");
  });

  it("skips the write when the candidate feed is empty", async () => {
    const { catalog } = await setup();
    getRecommendationsFeedMock.mockResolvedValue({ items: [], partial: false });
    rankCandidatesMock.mockResolvedValue([]);
    profileReadMock.mockResolvedValue(null);

    await writeRecommendationsForUser({ catalog }, "u1", new AbortController().signal);

    expect(await catalog.getRecommendations("u1")).toBeNull();
    expect(rankCandidatesMock).not.toHaveBeenCalled();
  });

  it("throws when the abort signal is already aborted", async () => {
    const { catalog } = await setup();
    const ctrl = new AbortController();
    ctrl.abort(new Error("cancelled"));

    await expect(writeRecommendationsForUser({ catalog }, "u1", ctrl.signal)).rejects.toThrow();
    expect(getRecommendationsFeedMock).not.toHaveBeenCalled();
  });

  it("forwards a deadline to rankCandidates so cold-fill cannot run unbounded", async () => {
    const { catalog } = await setup();
    getRecommendationsFeedMock.mockResolvedValue({
      items: [{ id: "movie:1", type: "movie", title: "One", ids: { tmdb_id: "1" } }],
      partial: false,
    });
    rankCandidatesMock.mockResolvedValue([
      {
        item: { id: "movie:1", type: "movie", title: "One" },
        score: 0.5,
        features: {},
        topContributors: [],
      },
    ]);
    explainRankedMock.mockResolvedValue(null);
    profileReadMock.mockResolvedValue({ version: 0 });
    void consola;

    await writeRecommendationsForUser({ catalog }, "u1", new AbortController().signal);

    const callArgs = rankCandidatesMock.mock.calls[0]?.[2];
    expect(callArgs?.deadlineMs).toBeGreaterThan(Date.now());
  });
});
