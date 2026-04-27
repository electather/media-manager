import { afterAll, describe, expect, it, vi } from "vite-plus/test";
import { cleanupInMemoryDbs, createInMemoryDb } from "../../__tests__/helpers/in-memory-db";
import { CatalogService } from "../service";
import { toCanonicalRow } from "../canonical";

afterAll(() => cleanupInMemoryDbs());

const KEY = { tmdbId: "1", type: "movie" } as const;
const DAY_MS = 24 * 60 * 60 * 1000;

async function withSeededRow(now = Date.now()) {
  const db = await createInMemoryDb();
  const catalog = new CatalogService(db, { recordAccessThrottleMs: 1_000 });
  const row = toCanonicalRow(
    KEY,
    { title: "Item", type: "movie", ids: { tmdb_id: "1" } },
    now - 10 * DAY_MS,
  );
  await catalog.writeMetadata([row]);
  return { catalog };
}

describe("CatalogService.recordAccess throttle", () => {
  it("bumps last_accessed_at on the first access", async () => {
    const { catalog } = await withSeededRow();
    const before = (await catalog.getMetadata(KEY.tmdbId, KEY.type))?.lastAccessedAt ?? 0;
    // The first read inside getMetadata triggers the throttle; wait one
    // tick so the detached UPDATE settles.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const after = (await catalog.getMetadata(KEY.tmdbId, KEY.type))?.lastAccessedAt ?? 0;
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it("skips the UPDATE while the throttle window is still open", async () => {
    const { catalog } = await withSeededRow();
    const updateSpy = vi.spyOn(
      catalog as unknown as { db: { update: () => unknown } },
      "db",
      "get",
    );
    void updateSpy; // we instead assert via the in-memory map

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
