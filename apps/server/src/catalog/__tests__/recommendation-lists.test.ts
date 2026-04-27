import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../__tests__/helpers/in-memory-db";
import { user } from "../../db/schema/auth";
import { CatalogService } from "../service";
import type { RecItem } from "../types";

afterAll(() => cleanupInMemoryDbs());

async function seedUser(db: Db, userId: string): Promise<void> {
  await db.insert(user).values({
    id: userId,
    name: userId,
    email: `${userId}@test`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

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
      { tmdbId: "1", mediaType: "movie", matchReason: "noir thriller", score: 0.91 },
      { tmdbId: "100", mediaType: "tv", matchReason: null, score: 0.82 },
    ];

    await catalog.writeRecommendationList("u1", "default", items, 7);

    const fetched = await catalog.getRecommendations("u1");
    expect(fetched?.profileVersion).toBe(7);
    expect(fetched?.items).toEqual(items);
    expect(fetched?.generatedAt).toBeGreaterThan(0);
  });

  it("upserts the same (user, kind) key with a fresh items list and version", async () => {
    const a: RecItem[] = [{ tmdbId: "1", mediaType: "movie", matchReason: null, score: 0.5 }];
    const b: RecItem[] = [{ tmdbId: "2", mediaType: "movie", matchReason: null, score: 0.7 }];
    await catalog.writeRecommendationList("u1", "default", a, 1);
    await catalog.writeRecommendationList("u1", "default", b, 2);

    const fetched = await catalog.getRecommendations("u1");
    expect(fetched?.profileVersion).toBe(2);
    expect(fetched?.items).toEqual(b);
  });
});
