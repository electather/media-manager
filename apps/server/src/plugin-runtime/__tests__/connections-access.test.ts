import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../__tests__/helpers/in-memory-db";
import { user } from "../../db/schema/auth";
import { plugins } from "../../db/schema/plugin-runtime/plugins";
import { serviceConnections } from "../../db/schema/plugin-runtime/credentials";

vi.mock("../../env", () => ({
  env: { ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef" },
}));

let testDb: Db;
vi.mock("../../db/client", () => ({ getDb: () => testDb }));

const { getConnectionById } = await import("../internal/connections-access");

const OWNER = "owner-user";
const OTHER = "other-user";
const OWNED_CONN = "conn-owned";

beforeAll(async () => {
  testDb = await createInMemoryDb();
  const now = Date.now();
  await testDb.insert(user).values([
    {
      id: OWNER,
      name: "owner",
      email: "owner@test",
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: OTHER,
      name: "other",
      email: "other@test",
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]);
  await testDb.insert(plugins).values({
    id: "plex",
    version: "1.0.0",
    sourceUrl: "builtin:plex",
    sourceType: "builtin",
    checksum: "x",
    manifest: "{}",
    installedAt: now,
    updatedAt: now,
  });
  await testDb.insert(serviceConnections).values({
    id: OWNED_CONN,
    userId: OWNER,
    pluginId: "plex",
    status: "connected",
    enabled: 1,
    isDefault: 0,
    encryptedCredentials: "enc",
    credentialsIv: "iv",
    createdAt: now,
    updatedAt: now,
  });
});

afterAll(() => cleanupInMemoryDbs());

// `getConnectionById` returns encrypted-credential handles, so the optional
// `userId` scoping is the IDOR guard: passing it must constrain the lookup to
// the caller's own rows. These lock the live `and(eq(id), eq(userId))` branch
// so a future refactor that drops the scoping clause fails loudly.
describe("getConnectionById userId scoping (IDOR guard)", () => {
  it("returns the row when userId matches the connection owner", async () => {
    const conn = await getConnectionById(OWNED_CONN, OWNER);
    expect(conn).not.toBeNull();
    expect(conn?.userId).toBe(OWNER);
  });

  it("returns null when userId does not match the connection owner", async () => {
    // The id exists, but it belongs to OWNER — a different user must not see it.
    const conn = await getConnectionById(OWNED_CONN, OTHER);
    expect(conn).toBeNull();
  });

  it("returns the row when userId is omitted (trusted server-side caller path)", async () => {
    const conn = await getConnectionById(OWNED_CONN);
    expect(conn).not.toBeNull();
    expect(conn?.userId).toBe(OWNER);
  });

  it("returns null for an unknown id regardless of scoping", async () => {
    expect(await getConnectionById("does-not-exist")).toBeNull();
    expect(await getConnectionById("does-not-exist", OWNER)).toBeNull();
  });
});
