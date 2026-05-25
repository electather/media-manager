import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../__tests__/helpers/in-memory-db";
import { user } from "../../db/schema/auth";
import { watchlistItems } from "../../db/schema/watchlist";

vi.mock("../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

vi.mock("../../db/client", async () => {
  const actual = await vi.importActual<typeof import("../../db/client")>("../../db/client");
  return {
    ...actual,
    getDb: () => testDb,
  };
});

const {
  decodeCursor,
  encodeCursor,
  getActiveRow,
  hasActiveRows,
  listActiveRows,
  listActiveRowsKeyset,
  listActiveRowsOffset,
} = await import("../repo");

let testDb: Db;

beforeAll(async () => {
  testDb = await createInMemoryDb();
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

async function seed(rows: { tmdbId: string; addedAt: number; state?: "active" | "removed" }[]) {
  await testDb.delete(watchlistItems);
  for (const r of rows) {
    await testDb.insert(watchlistItems).values({
      id: `id-${r.tmdbId}`,
      userId: "u1",
      tmdbId: r.tmdbId,
      mediaType: "movie",
      state: r.state ?? "active",
      source: "manual",
      addedAt: r.addedAt,
      removedAt: null,
      seeded: 0,
    });
  }
}

beforeEach(async () => {
  await testDb.delete(watchlistItems);
});

describe("media/repo", () => {
  describe("cursor codec", () => {
    it("encode + decode is a round trip for valid cursors", () => {
      const round = decodeCursor(encodeCursor({ addedAt: 1234, id: "abc" }));
      expect(round).toEqual({ addedAt: 1234, id: "abc" });
    });

    it("returns null on garbage input", () => {
      expect(decodeCursor("not-base64!!!")).toBeNull();
      expect(decodeCursor("")).toBeNull();
      expect(decodeCursor(Buffer.from("nocolon", "utf8").toString("base64url"))).toBeNull();
    });
  });

  describe("listActiveRowsKeyset", () => {
    it("paginates in (addedAt DESC, id DESC) order and respects limit", async () => {
      await seed([
        { tmdbId: "a", addedAt: 100 },
        { tmdbId: "b", addedAt: 200 },
        { tmdbId: "c", addedAt: 300 },
        { tmdbId: "d", addedAt: 400 },
      ]);
      const page1 = await listActiveRowsKeyset("u1", { limit: 2 });
      expect(page1.map((r) => r.tmdbId)).toEqual(["d", "c"]);

      const page2 = await listActiveRowsKeyset("u1", {
        limit: 2,
        cursor: { addedAt: page1[1]!.addedAt, id: page1[1]!.id },
      });
      expect(page2.map((r) => r.tmdbId)).toEqual(["b", "a"]);
    });

    it("breaks ties on addedAt by descending id", async () => {
      await testDb.insert(watchlistItems).values([
        {
          id: "z-id",
          userId: "u1",
          tmdbId: "z",
          mediaType: "movie",
          state: "active",
          source: "manual",
          addedAt: 100,
          removedAt: null,
          seeded: 0,
        },
        {
          id: "y-id",
          userId: "u1",
          tmdbId: "y",
          mediaType: "movie",
          state: "active",
          source: "manual",
          addedAt: 100,
          removedAt: null,
          seeded: 0,
        },
      ]);
      const rows = await listActiveRowsKeyset("u1", { limit: 10 });
      expect(rows.map((r) => r.id)).toEqual(["z-id", "y-id"]);
    });

    it("excludes removed rows", async () => {
      await seed([
        { tmdbId: "a", addedAt: 100, state: "removed" },
        { tmdbId: "b", addedAt: 200 },
      ]);
      const rows = await listActiveRowsKeyset("u1", { limit: 10 });
      expect(rows.map((r) => r.tmdbId)).toEqual(["b"]);
    });
  });

  describe("listActiveRowsOffset", () => {
    it("returns the limit/offset slice in keyset order so a slice matches the cursor walk", async () => {
      await seed([
        { tmdbId: "a", addedAt: 100 },
        { tmdbId: "b", addedAt: 200 },
        { tmdbId: "c", addedAt: 300 },
        { tmdbId: "d", addedAt: 400 },
        { tmdbId: "e", addedAt: 500 },
      ]);
      const slice = await listActiveRowsOffset("u1", { limit: 2, offset: 2 });
      expect(slice.map((r) => r.tmdbId)).toEqual(["c", "b"]);
    });

    it("returns empty when offset exceeds available rows", async () => {
      await seed([{ tmdbId: "a", addedAt: 100 }]);
      const rows = await listActiveRowsOffset("u1", { limit: 5, offset: 10 });
      expect(rows).toEqual([]);
    });
  });

  describe("listActiveRows", () => {
    it("returns every active row newest-first when no limit", async () => {
      await seed([
        { tmdbId: "a", addedAt: 100 },
        { tmdbId: "b", addedAt: 200 },
        { tmdbId: "c", addedAt: 300 },
      ]);
      const rows = await listActiveRows("u1");
      expect(rows.map((r) => r.tmdbId)).toEqual(["c", "b", "a"]);
    });

    it("limit clamps the result set", async () => {
      await seed([
        { tmdbId: "a", addedAt: 100 },
        { tmdbId: "b", addedAt: 200 },
        { tmdbId: "c", addedAt: 300 },
      ]);
      const rows = await listActiveRows("u1", { limit: 2 });
      expect(rows.map((r) => r.tmdbId)).toEqual(["c", "b"]);
    });

    it("state filter respects 'removed'", async () => {
      await seed([
        { tmdbId: "a", addedAt: 100, state: "removed" },
        { tmdbId: "b", addedAt: 200 },
      ]);
      const rows = await listActiveRows("u1", { state: "removed" });
      expect(rows.map((r) => r.tmdbId)).toEqual(["a"]);
    });
  });

  describe("getActiveRow", () => {
    it("returns the matching row regardless of state", async () => {
      await seed([{ tmdbId: "a", addedAt: 100, state: "removed" }]);
      const row = await getActiveRow("u1", { tmdbId: "a", mediaType: "movie" });
      expect(row?.state).toBe("removed");
    });

    it("returns null when no row matches", async () => {
      const row = await getActiveRow("u1", { tmdbId: "missing", mediaType: "movie" });
      expect(row).toBeNull();
    });
  });

  describe("hasActiveRows", () => {
    it("true when at least one active row exists", async () => {
      await seed([{ tmdbId: "a", addedAt: 100 }]);
      expect(await hasActiveRows("u1")).toBe(true);
    });

    it("false when only removed rows exist", async () => {
      await seed([{ tmdbId: "a", addedAt: 100, state: "removed" }]);
      expect(await hasActiveRows("u1")).toBe(false);
    });
  });
});
