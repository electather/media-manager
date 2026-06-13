import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import type { PreferenceProfile } from "@nama/shared/preferences";
import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../__tests__/helpers/in-memory-db";
import { user } from "../../db/schema/auth";
import { emptyFeatures } from "../internal/constants";

vi.mock("../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

let testDb: Db;
vi.mock("../../db/client", () => ({ getDb: () => testDb }));

const { profileStorage } = await import("../internal/profile-storage");

beforeAll(async () => {
  testDb = await createInMemoryDb();
  // Storage's read/write reference an FK on `user` so seed a single test user
  // up front. Foreign keys are enforced via PRAGMA in the in-memory helper.
  await testDb.insert(user).values({
    id: "u1",
    name: "u1",
    email: "u1@test",
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
});

afterAll(() => cleanupInMemoryDbs());

function makeProfile(now: number): PreferenceProfile {
  return {
    userId: "u1",
    mediaType: "movie",
    features: emptyFeatures(),
    sampleSize: 0,
    confidence: "low",
    lastRebuiltAt: now,
    lastUpdatedAt: now,
  };
}

describe("profileStorage version coordination", () => {
  it("starts version at 1 on first bumpVersion write", async () => {
    const now = Date.now();
    await profileStorage.write(makeProfile(now), { bumpVersion: true });

    const stored = await profileStorage.read("u1", "movie");
    expect(stored).not.toBeNull();
    expect(stored?.version).toBe(1);
  });

  it("increments version on subsequent bumpVersion writes", async () => {
    const now = Date.now();
    await profileStorage.write(makeProfile(now), { bumpVersion: true });

    const stored = await profileStorage.read("u1", "movie");
    expect(stored?.version).toBe(2);
  });

  it("does not touch version on writes without the bump flag", async () => {
    const before = await profileStorage.read("u1", "movie");
    expect(before?.version).toBe(2);

    await profileStorage.write(makeProfile(Date.now()));

    const after = await profileStorage.read("u1", "movie");
    expect(after?.version).toBe(2);
  });

  it("returns 0 on the very first write when bump is disabled", async () => {
    const now = Date.now();
    await profileStorage.write(
      {
        userId: "u1",
        mediaType: "tv",
        features: emptyFeatures(),
        sampleSize: 0,
        confidence: "low",
        lastRebuiltAt: now,
        lastUpdatedAt: now,
      },
      { bumpVersion: false },
    );

    const stored = await profileStorage.read("u1", "tv");
    expect(stored?.version).toBe(0);
  });
});
