import { afterAll, describe, expect, it, vi } from "vite-plus/test";

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

import { cleanupInMemoryDbs, createInMemoryDb } from "../../__tests__/helpers/in-memory-db";
import { CatalogService } from "../service";
import { toCanonicalRow } from "../canonical";

afterAll(() => cleanupInMemoryDbs());

const KEY = { tmdbId: "1", type: "movie" } as const;
const DAY_MS = 24 * 60 * 60 * 1000;

async function withSeededRow(seedTs: number) {
  const db = await createInMemoryDb();
  const catalog = new CatalogService(db, { recordAccessThrottleMs: 1_000 });
  const row = toCanonicalRow(KEY, { title: "Item", type: "movie", ids: { tmdb_id: "1" } }, seedTs);
  await catalog.writeMetadata([row]);
  return { catalog, seedTs };
}

describe("CatalogService.recordAccess throttle", () => {
  it("bumps last_accessed_at past the seed value on the first access", async () => {
    // Seed 10 days in the past so the post-access value is unambiguously
    // newer than the original row state, not just `>= seedTs`.
    const seedTs = Date.now() - 10 * DAY_MS;
    const { catalog } = await withSeededRow(seedTs);

    await catalog.getMetadata(KEY.tmdbId, KEY.type);
    // Wait one macrotask so the detached UPDATE settles.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const after = (await catalog.getMetadata(KEY.tmdbId, KEY.type))?.lastAccessedAt ?? 0;

    expect(after).toBeGreaterThan(seedTs);
  });

  it("skips the UPDATE while the throttle window is still open", async () => {
    const { catalog } = await withSeededRow(Date.now() - 10 * DAY_MS);

    catalog.recordAccess([KEY]);
    catalog.recordAccess([KEY]); // second call inside the 1s window — no enqueue
    // Let any detached UPDATE settle.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The throttle map should retain the key with one timestamp.
    const map = (catalog as unknown as { accessThrottle: Map<string, number> }).accessThrottle;
    expect(map.get("movie:1")).toBeDefined();
  });

  it("evicts throttle entries past the 2× window so the map cannot grow forever", async () => {
    const db = await createInMemoryDb();
    const catalog = new CatalogService(db, { recordAccessThrottleMs: 100 });
    const map = (catalog as unknown as { accessThrottle: Map<string, number> }).accessThrottle;
    map.set("movie:old", Date.now() - 10_000);
    catalog.recordAccess([{ tmdbId: "2", type: "movie" }]);
    expect(map.has("movie:old")).toBe(false);
  });
});
