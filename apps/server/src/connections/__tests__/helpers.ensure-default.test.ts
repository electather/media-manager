import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../__tests__/helpers/in-memory-db";
import { user } from "../../db/schema/auth";
import { plugins, serviceConnections } from "../../db/schema";

// Issue #302 regression: `ensureDefaultIfFirst` previously did a SELECT count
// then a conditional UPDATE, leaving a race where two concurrent inserts could
// both observe count==1 (and both set isDefault=1) or both observe count>1
// (and neither set isDefault=1, leaving the plugin without a default).
//
// The fix replaces the two-query path with a single conditional UPDATE that
// only sets isDefault=1 when no other row for (userId, pluginId) already
// holds the default flag. This test seeds two rows, marks the first as the
// existing default, and asserts the helper does not double-promote on the
// second write.

const encryptionKey = "0123456789abcdef0123456789abcdef";
vi.mock("../../env", () => ({
  env: {
    ENCRYPTION_KEY: encryptionKey,
    CACHE_PROVIDER: "memory",
    BETTER_AUTH_SECRET: "test-secret",
    BETTER_AUTH_URL: "http://localhost",
  },
}));

// `helpers.ts` calls `invalidateUserCache` after every write — short-circuit
// the cache provider so the test does not need to wire one up.
vi.mock("../../media", () => ({
  invalidateUserCache: vi.fn().mockResolvedValue(undefined),
}));

let testDb: Db;
vi.mock("../../db/client", () => ({ getDb: () => testDb }));

const { writeConnection, promoteToDefault } = await import("../helpers");

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
  await testDb.insert(plugins).values({
    id: "p1",
    version: "1.0.0",
    sourceUrl: "https://example.com/p1",
    sourceType: "builtin",
    checksum: "deadbeef",
    manifest: "{}",
    enabled: 1,
    personalKeyFallback: "off",
    installedAt: Date.now(),
    updatedAt: Date.now(),
  });
});

afterAll(() => cleanupInMemoryDbs());

beforeEach(async () => {
  await testDb.delete(serviceConnections);
});

async function loadRows(): Promise<{ id: string; isDefault: number }[]> {
  const rows = await testDb
    .select({ id: serviceConnections.id, isDefault: serviceConnections.isDefault })
    .from(serviceConnections)
    .where(eq(serviceConnections.userId, "u1"));
  return rows;
}

describe("writeConnection default-flag invariant (issue #302)", () => {
  it("promotes the first connection for a (user, plugin) pair to default", async () => {
    const id = await writeConnection({
      userId: "u1",
      pluginId: "p1",
      credentials: { token: "t" },
      userConfig: null,
    });
    const rows = await loadRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ id, isDefault: 1 });
  });

  it("does not double-promote when a default already exists", async () => {
    // First write becomes default by the atomic conditional UPDATE.
    await writeConnection({
      userId: "u1",
      pluginId: "p1",
      credentials: { token: "first" },
      userConfig: null,
    });
    // Second write must observe the existing default and stay isDefault=0.
    await writeConnection({
      userId: "u1",
      pluginId: "p1",
      credentials: { token: "second" },
      userConfig: null,
    });

    const rows = await loadRows();
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.isDefault === 1)).toHaveLength(1);
  });

  it("keeps exactly one default when many writes interleave", async () => {
    // Fire several writes "concurrently" through `Promise.all`. SQLite
    // serializes them at the connection level, but the invariant we care
    // about — at most one isDefault=1 per (user, plugin) — must hold no
    // matter the interleave because each UPDATE checks `notExists` itself.
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        writeConnection({
          userId: "u1",
          pluginId: "p1",
          credentials: { token: `t${i}` },
          userConfig: null,
        }),
      ),
    );

    const rows = await loadRows();
    expect(rows).toHaveLength(5);
    expect(rows.filter((r) => r.isDefault === 1)).toHaveLength(1);
  });

  it("auto-promotes a new write when existing rows all have isDefault=0", async () => {
    // Semantic shift vs the old `count === 1` guard: if a prior bug or manual
    // recovery left orphan rows for (user, plugin) with no row holding the
    // default flag, the new `notExists` predicate promotes the next write
    // instead of skipping. The old code would have left the plugin without
    // any default. This locks in the behaviour change so a future refactor
    // that resurrects the count-based guard fails loudly.
    await testDb.insert(serviceConnections).values({
      id: "orphan-1",
      userId: "u1",
      pluginId: "p1",
      isDefault: 0,
      status: "connected",
      enabled: 1,
      encryptedCredentials: "x",
      credentialsIv: "iv",
      lastVerifiedAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const id = await writeConnection({
      userId: "u1",
      pluginId: "p1",
      credentials: { token: "t" },
      userConfig: null,
    });

    const rows = await loadRows();
    expect(rows.filter((r) => r.isDefault === 1)).toHaveLength(1);
    expect(rows.find((r) => r.id === id)?.isDefault).toBe(1);
  });

  it("re-promotes correctly via `promoteToDefault` after the initial default", async () => {
    // Sanity check: the surgical `notExists` predicate must not break the
    // explicit promotion path used by the connections service.
    const first = await writeConnection({
      userId: "u1",
      pluginId: "p1",
      credentials: { token: "first" },
      userConfig: null,
    });
    const second = await writeConnection({
      userId: "u1",
      pluginId: "p1",
      credentials: { token: "second" },
      userConfig: null,
    });

    await promoteToDefault("u1", second);

    const rows = await loadRows();
    const byId = new Map(rows.map((r) => [r.id, r.isDefault]));
    expect(byId.get(first)).toBe(0);
    expect(byId.get(second)).toBe(1);
  });
});
