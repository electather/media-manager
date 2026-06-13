import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../env", () => ({
  env: {
    CACHE_PROVIDER: "memory",
    ENCRYPTION_KEY: "test-key",
    SQLITE_PATH: "file::memory:",
    BETTER_AUTH_SECRET: "x".repeat(32),
    BETTER_AUTH_URL: "http://localhost",
    APP_EXTERNAL_URL: "http://localhost",
  },
}));

import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../__tests__/helpers/in-memory-db";
import { CatalogService } from "../service";
import type { HistoryEvent, RatingEvent } from "@nama/shared/catalog";
import { seedUser } from "./helpers";

afterAll(() => cleanupInMemoryDbs());

function historyEvent(overrides: Partial<HistoryEvent> = {}): HistoryEvent {
  return {
    tmdbId: "1",
    mediaType: "movie",
    watchedAt: 1_000,
    sourceConnectionId: "trakt",
    episodeKey: null,
    progress: 1,
    ...overrides,
  };
}

function ratingEvent(overrides: Partial<RatingEvent> = {}): RatingEvent {
  return {
    tmdbId: "1",
    mediaType: "movie",
    rating: 9,
    ratedAt: 2_000,
    sourceConnectionId: "trakt",
    ...overrides,
  };
}

describe("CatalogService user mirrors", () => {
  let db: Db;
  let catalog: CatalogService;

  beforeEach(async () => {
    db = await createInMemoryDb();
    catalog = new CatalogService(db);
    await seedUser(db, "u1");
  });

  it("appends history events keyed on the composite dedupe tuple", async () => {
    await catalog.appendUserHistory("u1", [historyEvent()], "trakt", 1_000);
    await catalog.appendUserHistory(
      "u1",
      [historyEvent(), historyEvent({ tmdbId: "2", watchedAt: 1_500 })],
      "trakt",
      1_500,
    );

    const events = await catalog.getUserHistory("u1");
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.tmdbId)).toEqual(["1", "2"]);
  });

  it("advances the cursor monotonically via max(prior, incoming)", async () => {
    await catalog.appendUserHistory("u1", [historyEvent()], "trakt", 5_000);
    await catalog.appendUserHistory(
      "u1",
      [historyEvent({ tmdbId: "2", watchedAt: 100 })],
      "trakt",
      100,
    );

    const cursors = await catalog.getHistoryCursors("u1");
    expect(cursors.trakt).toBe(5_000);
  });

  it("keeps history and ratings cursors independent", async () => {
    await catalog.appendUserHistory("u1", [historyEvent()], "trakt", 5_000);
    await catalog.appendUserRatings("u1", [ratingEvent()], "trakt", 9_000);

    expect(await catalog.getHistoryCursors("u1")).toEqual({ trakt: 5_000 });
    expect(await catalog.getRatingsCursors("u1")).toEqual({ trakt: 9_000 });
  });

  it("serializes concurrent appends for the same user via the per-user mutex", async () => {
    const a: HistoryEvent[] = [
      historyEvent({ tmdbId: "1", watchedAt: 100 }),
      historyEvent({ tmdbId: "2", watchedAt: 200 }),
    ];
    const b: HistoryEvent[] = [
      historyEvent({ tmdbId: "3", watchedAt: 300 }),
      historyEvent({ tmdbId: "4", watchedAt: 400 }),
    ];

    await Promise.all([
      catalog.appendUserHistory("u1", a, "trakt", 200),
      catalog.appendUserHistory("u1", b, "trakt", 400),
    ]);

    const events = await catalog.getUserHistory("u1");
    const ids = events.map((e) => e.tmdbId).sort();
    expect(ids).toEqual(["1", "2", "3", "4"]);
  });

  it("treats episodeKey as part of the dedupe tuple for history", async () => {
    const e1 = historyEvent({ episodeKey: "s1e1", watchedAt: 100 });
    const e2 = historyEvent({ episodeKey: "s1e2", watchedAt: 200 });
    await catalog.appendUserHistory("u1", [e1, e2], "trakt", 200);
    const events = await catalog.getUserHistory("u1");
    expect(events).toHaveLength(2);
  });

  it("dedupes ratings on (tmdbId, mediaType, sourceConnectionId, ratedAt)", async () => {
    await catalog.appendUserRatings("u1", [ratingEvent()], "trakt", 2_000);
    await catalog.appendUserRatings("u1", [ratingEvent()], "trakt", 2_000);
    expect(await catalog.getUserRatings("u1")).toHaveLength(1);
  });

  it("serializes concurrent rating appends for the same user via the per-user mutex", async () => {
    const a: RatingEvent[] = [
      ratingEvent({ tmdbId: "1", ratedAt: 100 }),
      ratingEvent({ tmdbId: "2", ratedAt: 200 }),
    ];
    const b: RatingEvent[] = [
      ratingEvent({ tmdbId: "3", ratedAt: 300 }),
      ratingEvent({ tmdbId: "4", ratedAt: 400 }),
    ];

    await Promise.all([
      catalog.appendUserRatings("u1", a, "trakt", 200),
      catalog.appendUserRatings("u1", b, "trakt", 400),
    ]);

    const events = await catalog.getUserRatings("u1");
    const ids = events.map((e) => e.tmdbId).sort();
    expect(ids).toEqual(["1", "2", "3", "4"]);
  });
});
