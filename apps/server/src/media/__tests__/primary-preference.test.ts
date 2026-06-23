import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../__tests__/helpers/in-memory-db";
import { user } from "../../db/schema/auth";
import { plugins, serviceConnections } from "../../db/schema";
import { primaryConnections } from "../../db/schema/preferences/user-preferences";

// Issue #458 regression: #458: prior SELECT-then-INSERT outside transaction allowed
// concurrent race to both INSERT, hitting PK and 500-ing. Fix: single `onConflictDoUpdate`
// upsert. Test races concurrent calls and asserts no reject + one row after.

vi.mock("../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

let testDb: Db;
vi.mock("../../db/client", () => ({ getDb: () => testDb }));

const { setPrimaryConnection, getPrimaryConnection, clearPrimaryConnection } =
  await import("../service/primary-preference");

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
  await testDb.insert(serviceConnections).values([
    {
      id: "c1",
      userId: "u1",
      pluginId: "p1",
      status: "connected",
      enabled: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      id: "c2",
      userId: "u1",
      pluginId: "p1",
      status: "connected",
      enabled: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ]);
});

afterAll(() => cleanupInMemoryDbs());

beforeEach(async () => {
  await testDb.delete(primaryConnections);
});

async function loadPrimaryRows(): Promise<{ connectionId: string }[]> {
  return testDb
    .select({ connectionId: primaryConnections.connectionId })
    .from(primaryConnections)
    .where(eq(primaryConnections.userId, "u1"));
}

describe("setPrimaryConnection", () => {
  it("inserts a row when no primary exists for the tuple", async () => {
    await setPrimaryConnection({
      userId: "u1",
      capabilityKey: "metadata@v1",
      mediaType: "movie",
      connectionId: "c1",
    });

    const rows = await loadPrimaryRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.connectionId).toBe("c1");
  });

  it("updates the existing row instead of erroring on a second call", async () => {
    await setPrimaryConnection({
      userId: "u1",
      capabilityKey: "metadata@v1",
      mediaType: "movie",
      connectionId: "c1",
    });
    await setPrimaryConnection({
      userId: "u1",
      capabilityKey: "metadata@v1",
      mediaType: "movie",
      connectionId: "c2",
    });

    const rows = await loadPrimaryRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.connectionId).toBe("c2");
  });

  it("does not throw or duplicate rows when two writes race for the same tuple", async () => {
    // Without the upsert fix, both calls observed `existing==null` and both
    // ran INSERT; the second hit the (userId, capabilityKey, mediaType) PK
    // and rejected with a unique-constraint 500.
    await expect(
      Promise.all([
        setPrimaryConnection({
          userId: "u1",
          capabilityKey: "metadata@v1",
          mediaType: "movie",
          connectionId: "c1",
        }),
        setPrimaryConnection({
          userId: "u1",
          capabilityKey: "metadata@v1",
          mediaType: "movie",
          connectionId: "c2",
        }),
      ]),
    ).resolves.toBeDefined();

    const rows = await loadPrimaryRows();
    expect(rows).toHaveLength(1);
    expect(["c1", "c2"]).toContain(rows[0]?.connectionId);
  });

  it("keeps separate rows per mediaType for the same capability", async () => {
    await setPrimaryConnection({
      userId: "u1",
      capabilityKey: "metadata@v1",
      mediaType: "movie",
      connectionId: "c1",
    });
    await setPrimaryConnection({
      userId: "u1",
      capabilityKey: "metadata@v1",
      mediaType: "tv",
      connectionId: "c2",
    });

    const rows = await loadPrimaryRows();
    expect(rows).toHaveLength(2);

    await expect(
      getPrimaryConnection({ userId: "u1", capabilityKey: "metadata@v1", mediaType: "movie" }),
    ).resolves.toEqual({ connectionId: "c1", pluginId: "p1" });
    await expect(
      getPrimaryConnection({ userId: "u1", capabilityKey: "metadata@v1", mediaType: "tv" }),
    ).resolves.toEqual({ connectionId: "c2", pluginId: "p1" });

    await clearPrimaryConnection({
      userId: "u1",
      capabilityKey: "metadata@v1",
      mediaType: "movie",
    });
    expect(await loadPrimaryRows()).toHaveLength(1);
  });
});
