import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  createInMemoryDb,
  cleanupInMemoryDbs,
  type Db,
} from "../../__tests__/helpers/in-memory-db";

vi.mock("../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

let testDb: Db;
vi.mock("../../db/client", () => ({
  getDb: () => testDb,
}));

const { listUsersNeedingDailyRebuild } = await import("../internal/rebuild-row-source");
const { user } = await import("../../db/schema/auth");
const { feedback, preferenceProfiles } = await import("../../db/schema");

afterAll(() => cleanupInMemoryDbs());

const FRESH_THRESHOLD_MS = 6 * 60 * 60 * 1000;

async function seedUser(userId: string): Promise<void> {
  await testDb.insert(user).values({
    id: userId,
    name: userId,
    email: `${userId}@test`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

async function seedFeedback(userId: string, createdAt: number): Promise<void> {
  await testDb.insert(feedback).values({
    id: `${userId}-fb-${createdAt}`,
    userId,
    tmdbId: "1",
    mediaType: "movie",
    action: "like",
    rating: null,
    note: null,
    noteSentiment: null,
    noteKeywords: null,
    createdAt,
  });
}

async function seedCombinedProfile(userId: string, lastRebuiltAt: number): Promise<void> {
  await testDb.insert(preferenceProfiles).values({
    userId,
    mediaType: "combined",
    features: "{}",
    sampleSize: 10,
    confidence: "low",
    lastRebuiltAt,
    lastUpdatedAt: lastRebuiltAt,
    embedding: null,
    embeddingModel: null,
    version: 1,
  });
}

beforeEach(async () => {
  testDb = await createInMemoryDb();
});

describe("listUsersNeedingDailyRebuild", () => {
  it("drops users whose combined profile is fresher than the window threshold", async () => {
    const now = Date.now();
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    await seedUser("u-fresh");
    await seedUser("u-stale");
    await seedFeedback("u-fresh", now - 1_000);
    await seedFeedback("u-stale", now - 1_000);
    // `u-stale` qualifies for the underlying `listUsersNeedingRebuild`
    // through the >7d stale-profile branch; the fresh-window filter then
    // decides whether the daily safety-net sweep keeps or drops them.
    await seedCombinedProfile("u-fresh", now - 1_000);
    await seedCombinedProfile("u-stale", now - SEVEN_DAYS_MS - 1_000);

    const rows = await listUsersNeedingDailyRebuild(now);
    const ids = rows.map((r) => r.userId).sort();
    expect(ids).not.toContain("u-fresh");
    expect(ids).toContain("u-stale");
  });

  it("retains users with no profile so first-run rebuilds still happen", async () => {
    const now = Date.now();
    await seedUser("u-new");
    await seedFeedback("u-new", now - 1_000);

    const rows = await listUsersNeedingDailyRebuild(now);
    expect(rows.map((r) => r.userId)).toContain("u-new");
  });
});

// Suppress unused-binding warning while we keep the export in scope for
// future tests that drive the "stale within freshness window" branch.
void FRESH_THRESHOLD_MS;
