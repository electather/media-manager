import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../__tests__/helpers/in-memory-db";
import { user } from "../../db/schema/auth";
import { plugins, serviceConnections } from "../../db/schema";

vi.mock("../../env", () => ({
  env: {
    ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
    CACHE_PROVIDER: "memory",
  },
}));

let testDb: Db;
vi.mock("../../db/client", () => ({ getDb: () => testDb }));

const { requireConnection } = await import("../helpers");

beforeAll(async () => {
  testDb = await createInMemoryDb();
  await testDb.insert(user).values([
    {
      id: "owner",
      name: "owner",
      email: "owner@test",
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: "intruder",
      name: "intruder",
      email: "intruder@test",
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]);
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

async function seedConnection(id: string, userId: string): Promise<void> {
  await testDb.insert(serviceConnections).values({
    id,
    userId,
    pluginId: "p1",
    status: "connected",
    enabled: 1,
    isDefault: 0,
    encryptedCredentials: "",
    credentialsIv: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}

describe("requireConnection", () => {
  it("returns the row when the caller owns the connection", async () => {
    await seedConnection("c1", "owner");
    const row = await requireConnection(testDb, "c1", "owner");
    expect(row.id).toBe("c1");
    expect(row.userId).toBe("owner");
  });

  it("throws connection.not_found when no row exists for the id", async () => {
    await expect(requireConnection(testDb, "missing", "owner")).rejects.toMatchObject({
      status: 404,
      code: "connection.not_found",
    });
  });

  it("throws connection.not_found when the row belongs to a different user", async () => {
    // Returning the same 404 for "missing" and "foreign" stops a hostile
    // caller from probing for connection ids it doesn't own.
    await seedConnection("c1", "owner");
    await expect(requireConnection(testDb, "c1", "intruder")).rejects.toMatchObject({
      status: 404,
      code: "connection.not_found",
    });
  });
});
