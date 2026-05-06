import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../__tests__/helpers/in-memory-db";
import { CatalogService } from "../service";
import type { RecItem } from "../types";
import { seedUser } from "./helpers";

afterAll(() => cleanupInMemoryDbs());

describe("CatalogService recommendation_lists", () => {
  let db: Db;
  let catalog: CatalogService;

  beforeEach(async () => {
    db = await createInMemoryDb();
    catalog = new CatalogService(db);
    await seedUser(db, "u1");
  });

  it("returns null when no list exists for the user", async () => {
    expect(await catalog.getRecommendations("u1")).toBeNull();
  });

  it("round-trips items + profile_version + generated_at", async () => {
    const items: RecItem[] = [
      {
        tmdbId: "1",
        mediaType: "movie",
        matchReason: "noir thriller",
        topContributors: [
          { category: "genre", value: "Drama", weight: 0.42 },
          { category: "person", value: "Lena Marsh", weight: 0.18 },
        ],
        score: 0.91,
      },
      {
        tmdbId: "100",
        mediaType: "tv",
        matchReason: null,
        topContributors: [],
        score: 0.82,
      },
    ];

    await catalog.writeRecommendationList("u1", "default", items, 7);

    const fetched = await catalog.getRecommendations("u1");
    expect(fetched?.profileVersion).toBe(7);
    expect(fetched?.items).toEqual(items);
    expect(fetched?.generatedAt).toBeGreaterThan(0);
  });

  it("upserts the same (user, kind) key with a fresh items list and version", async () => {
    const a: RecItem[] = [
      { tmdbId: "1", mediaType: "movie", matchReason: null, topContributors: [], score: 0.5 },
    ];
    const b: RecItem[] = [
      {
        tmdbId: "2",
        mediaType: "movie",
        matchReason: null,
        topContributors: [{ category: "genre", value: "Sci-Fi", weight: 0.31 }],
        score: 0.7,
      },
    ];
    await catalog.writeRecommendationList("u1", "default", a, 1);
    await catalog.writeRecommendationList("u1", "default", b, 2);

    const fetched = await catalog.getRecommendations("u1");
    expect(fetched?.profileVersion).toBe(2);
    expect(fetched?.items).toEqual(b);
  });

  it("backfills topContributors=[] for legacy rows missing the field", async () => {
    // Simulate a row written before the topContributors snapshot landed by
    // bypassing the typed `writeRecommendationList` path and inserting raw
    // JSON without the field. The read path must default it to `[]`.
    const legacyItems = [
      { tmdbId: "9", mediaType: "movie" as const, matchReason: "legacy", score: 0.5 },
    ] as unknown as RecItem[];
    await catalog.writeRecommendationList("u1", "default", legacyItems, 0);

    const fetched = await catalog.getRecommendations("u1");
    expect(fetched?.items[0]?.topContributors).toEqual([]);
  });
});
