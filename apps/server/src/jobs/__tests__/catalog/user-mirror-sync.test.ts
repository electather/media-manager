import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { consola } from "consola";

vi.mock("../../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

const getAllHistoryMock = vi.fn();
const getAllRatingsMock = vi.fn();
class FakeMediaService {
  async getAllHistory(...args: unknown[]) {
    return getAllHistoryMock(...args);
  }
  async getAllRatings(...args: unknown[]) {
    return getAllRatingsMock(...args);
  }
}
vi.mock("../../../media/service", () => ({ MediaService: FakeMediaService }));

const { cleanupInMemoryDbs, createInMemoryDb } =
  await import("../../../__tests__/helpers/in-memory-db");
const { user } = await import("../../../db/schema/auth");
const { CatalogService } = await import("../../../catalog/service");
const { syncUserPluginPair } = await import("../../../catalog/jobs/user-mirror-sync");
import type { JobRunContext } from "../../types";

afterAll(() => cleanupInMemoryDbs());

beforeEach(() => {
  getAllHistoryMock.mockReset();
  getAllRatingsMock.mockReset();
});

function buildJobCtx(overrides: Partial<JobRunContext> = {}): JobRunContext {
  return {
    runId: "run-1",
    triggeredBy: "cron",
    requestId: "req-1",
    logger: consola,
    abortSignal: new AbortController().signal,
    ...overrides,
  };
}

async function seed(): Promise<{ catalog: InstanceType<typeof CatalogService> }> {
  const db = await createInMemoryDb();
  await db.insert(user).values({
    id: "u1",
    name: "u1",
    email: "u1@test",
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return { catalog: new CatalogService(db) };
}

describe("host.catalog.user_mirror_sync handler", () => {
  it("appends new history and rating events from a single dispatch run", async () => {
    const { catalog } = await seed();
    getAllHistoryMock.mockResolvedValue([
      {
        item: { id: "movie:1", type: "movie", ids: { tmdb_id: "1" } },
        watchedAt: "2026-01-01T00:00:00Z",
      },
    ]);
    getAllRatingsMock.mockResolvedValue([
      {
        item: { id: "movie:1", type: "movie", ids: { tmdb_id: "1" } },
        rating: 9,
        ratedAt: "2026-01-02T00:00:00Z",
      },
    ]);

    await syncUserPluginPair({ catalog }, buildJobCtx(), { userId: "u1", pluginId: "trakt" });

    expect(await catalog.getUserHistory("u1")).toHaveLength(1);
    expect(await catalog.getUserRatings("u1")).toHaveLength(1);
  });

  it("does not advance the history cursor when the history dispatch fails", async () => {
    const { catalog } = await seed();
    getAllHistoryMock.mockRejectedValue(new Error("plugin offline"));
    getAllRatingsMock.mockResolvedValue([
      {
        item: { id: "movie:1", type: "movie", ids: { tmdb_id: "1" } },
        rating: 8,
        ratedAt: "2026-01-02T00:00:00Z",
      },
    ]);

    await syncUserPluginPair({ catalog }, buildJobCtx(), { userId: "u1", pluginId: "trakt" });

    expect(await catalog.getHistoryCursors("u1")).toEqual({});
    expect(await catalog.getRatingsCursors("u1")).toEqual({
      trakt: Date.parse("2026-01-02T00:00:00Z"),
    });
  });

  it("re-running the sync does not duplicate already-mirrored events", async () => {
    const { catalog } = await seed();
    const payload = [
      {
        item: { id: "movie:1", type: "movie", ids: { tmdb_id: "1" } },
        watchedAt: "2026-01-01T00:00:00Z",
      },
    ];
    getAllHistoryMock.mockResolvedValue(payload);
    getAllRatingsMock.mockResolvedValue([]);

    await syncUserPluginPair({ catalog }, buildJobCtx(), { userId: "u1", pluginId: "trakt" });
    await syncUserPluginPair({ catalog }, buildJobCtx(), { userId: "u1", pluginId: "trakt" });

    expect(await catalog.getUserHistory("u1")).toHaveLength(1);
  });

  it("propagates the abort error to the job runner instead of swallowing it", async () => {
    const { catalog } = await seed();
    const aborter = new AbortController();
    aborter.abort(new Error("cancelled"));

    await expect(
      syncUserPluginPair({ catalog }, buildJobCtx({ abortSignal: aborter.signal }), {
        userId: "u1",
        pluginId: "trakt",
      }),
    ).rejects.toThrow();

    expect(getAllHistoryMock).not.toHaveBeenCalled();
    expect(getAllRatingsMock).not.toHaveBeenCalled();
  });

  it("re-throws when the signal fires between the history and ratings blocks", async () => {
    const { catalog } = await seed();
    const aborter = new AbortController();
    getAllHistoryMock.mockImplementation(async () => {
      // Cancel mid-flight so the next abort check between blocks fires.
      aborter.abort(new Error("cancelled"));
      return [];
    });
    getAllRatingsMock.mockResolvedValue([]);

    await expect(
      syncUserPluginPair({ catalog }, buildJobCtx({ abortSignal: aborter.signal }), {
        userId: "u1",
        pluginId: "trakt",
      }),
    ).rejects.toThrow();

    expect(getAllHistoryMock).toHaveBeenCalledOnce();
    expect(getAllRatingsMock).not.toHaveBeenCalled();
  });

  it("drops rating events with a missing ratedAt to keep the dedupe key stable", async () => {
    const { catalog } = await seed();
    getAllHistoryMock.mockResolvedValue([]);
    getAllRatingsMock.mockResolvedValue([
      {
        item: { id: "movie:1", type: "movie", ids: { tmdb_id: "1" } },
        rating: 9,
        // ratedAt intentionally missing — must be dropped, not assigned Date.now().
      },
    ]);

    await syncUserPluginPair({ catalog }, buildJobCtx(), { userId: "u1", pluginId: "trakt" });

    expect(await catalog.getUserRatings("u1")).toEqual([]);
  });
});
