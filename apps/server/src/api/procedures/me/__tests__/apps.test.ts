import { describe, expect, it, beforeEach, afterAll, vi } from "vite-plus/test";

vi.mock("../../../../env", () => ({
  env: {
    CACHE_PROVIDER: "memory",
    ENCRYPTION_KEY: "test-key",
    SQLITE_PATH: "file::memory:",
    BETTER_AUTH_SECRET: "x".repeat(32),
    BETTER_AUTH_URL: "http://localhost",
    APP_EXTERNAL_URL: "http://localhost",
  },
}));

import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../../../__tests__/helpers/in-memory-db";
import { listAuthorizedApps, revokeAuthorizedApp } from "../apps";
import {
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
  user,
} from "../../../../db/schema/auth";
import { eq } from "drizzle-orm";

const USER = "user-1";
const OTHER_USER = "user-2";

let db: Db;

beforeEach(async () => {
  db = await createInMemoryDb();
  await seedTwoUsers(db);
});

afterAll(() => cleanupInMemoryDbs());

describe("listAuthorizedApps", () => {
  it("returns one row per consented client with name fallback and last-used aggregation", async () => {
    await seedClient(db, "client-named", { ownerUserId: null, name: "My MCP App" });
    await seedClient(db, "client-anon", { ownerUserId: null, name: null });
    await seedConsent(db, USER, "client-named", ["read", "write"], 1_000);
    await seedConsent(db, USER, "client-anon", ["read"], 2_000);
    await seedAccessToken(db, USER, "client-named", 5_000);
    await seedAccessToken(db, USER, "client-named", 9_000);

    const apps = await listAuthorizedApps(db, USER);

    expect(apps).toHaveLength(2);
    const named = apps.find((a) => a.clientId === "client-named")!;
    expect(named.name).toBe("My MCP App");
    expect(named.scopes).toEqual(["read", "write"]);
    expect(named.connectedAt).toBe(1_000);
    expect(named.lastUsedAt).toBe(9_000);
    expect(named.ownedByUser).toBe(false);
    expect(named.status).toBe("idle");

    const anon = apps.find((a) => a.clientId === "client-anon")!;
    expect(anon.name).toBe("client-anon");
    expect(anon.lastUsedAt).toBeNull();
  });

  it("flags status='active' when a token was issued in the last 5 minutes", async () => {
    const recent = Date.now() - 60_000;
    await seedClient(db, "fresh", { ownerUserId: null, name: "Fresh" });
    await seedConsent(db, USER, "fresh", [], recent - 1_000);
    await seedAccessToken(db, USER, "fresh", recent);

    const apps = await listAuthorizedApps(db, USER);
    expect(apps[0]?.status).toBe("active");
  });

  it("flags status='new' for a consent under 24h with no tokens issued", async () => {
    const recent = Date.now() - 60_000;
    await seedClient(db, "rookie", { ownerUserId: null, name: "Rookie" });
    await seedConsent(db, USER, "rookie", [], recent);

    const apps = await listAuthorizedApps(db, USER);
    expect(apps[0]?.status).toBe("new");
    expect(apps[0]?.lastUsedAt).toBeNull();
  });

  it("flags status='idle' when the consent is older than 24h with no recent tokens", async () => {
    const old = Date.now() - 30 * 24 * 60 * 60 * 1000;
    await seedClient(db, "stale", { ownerUserId: null, name: "Stale" });
    await seedConsent(db, USER, "stale", [], old);

    const apps = await listAuthorizedApps(db, USER);
    expect(apps[0]?.status).toBe("idle");
  });

  it("excludes other users' consents", async () => {
    await seedClient(db, "shared-client", { ownerUserId: null, name: null });
    await seedConsent(db, USER, "shared-client", [], 1);
    await seedConsent(db, OTHER_USER, "shared-client", [], 2);

    const mine = await listAuthorizedApps(db, USER);
    const theirs = await listAuthorizedApps(db, OTHER_USER);

    expect(mine).toHaveLength(1);
    expect(theirs).toHaveLength(1);
  });

  it("flags ownedByUser when the client's userId matches", async () => {
    await seedClient(db, "owned-client", { ownerUserId: USER, name: "Mine" });
    await seedConsent(db, USER, "owned-client", [], 1);

    const apps = await listAuthorizedApps(db, USER);

    expect(apps[0]?.ownedByUser).toBe(true);
  });
});

describe("revokeAuthorizedApp", () => {
  it("deletes tokens and consent for the (user, client) pair, returns updated list", async () => {
    await seedClient(db, "c1", { ownerUserId: null, name: "C1" });
    await seedClient(db, "c2", { ownerUserId: null, name: "C2" });
    await seedConsent(db, USER, "c1", [], 1);
    await seedConsent(db, USER, "c2", [], 2);
    await seedAccessToken(db, USER, "c1", 100);
    await seedRefreshToken(db, USER, "c1");

    const result = await revokeAuthorizedApp(db, USER, "c1");

    expect(result.apps.map((a) => a.clientId)).toEqual(["c2"]);

    const accessRows = await db
      .select()
      .from(oauthAccessToken)
      .where(eq(oauthAccessToken.userId, USER))
      .all();
    expect(accessRows).toHaveLength(0);

    const refreshRows = await db
      .select()
      .from(oauthRefreshToken)
      .where(eq(oauthRefreshToken.userId, USER))
      .all();
    expect(refreshRows).toHaveLength(0);

    const consents = await db
      .select()
      .from(oauthConsent)
      .where(eq(oauthConsent.userId, USER))
      .all();
    expect(consents.map((c) => c.clientId)).toEqual(["c2"]);
  });

  it("deletes a user-owned client when no other consents reference it", async () => {
    await seedClient(db, "own-only", { ownerUserId: USER, name: "Mine" });
    await seedConsent(db, USER, "own-only", [], 1);

    await revokeAuthorizedApp(db, USER, "own-only");

    const clientRow = await db
      .select()
      .from(oauthClient)
      .where(eq(oauthClient.clientId, "own-only"))
      .get();
    expect(clientRow).toBeUndefined();
  });

  it("preserves a user-owned client when another user's consent still references it", async () => {
    await seedClient(db, "shared-mine", { ownerUserId: USER, name: "Shared" });
    await seedConsent(db, USER, "shared-mine", [], 1);
    await seedConsent(db, OTHER_USER, "shared-mine", [], 2);

    await revokeAuthorizedApp(db, USER, "shared-mine");

    const clientRow = await db
      .select()
      .from(oauthClient)
      .where(eq(oauthClient.clientId, "shared-mine"))
      .get();
    expect(clientRow).toBeDefined();

    const otherConsent = await db
      .select()
      .from(oauthConsent)
      .where(eq(oauthConsent.userId, OTHER_USER))
      .all();
    expect(otherConsent).toHaveLength(1);
  });

  it("does NOT delete a client owned by another user", async () => {
    await seedClient(db, "their-client", { ownerUserId: OTHER_USER, name: "Theirs" });
    await seedConsent(db, USER, "their-client", [], 1);

    await revokeAuthorizedApp(db, USER, "their-client");

    const clientRow = await db
      .select()
      .from(oauthClient)
      .where(eq(oauthClient.clientId, "their-client"))
      .get();
    expect(clientRow).toBeDefined();
  });

  it("throws 404 when the user has no consent for that client", async () => {
    await seedClient(db, "ghost", { ownerUserId: null, name: null });

    await expect(revokeAuthorizedApp(db, USER, "ghost")).rejects.toMatchObject({
      status: 404,
      code: "me.app_not_authorized",
    });
  });
});

// ─── seed helpers ─────────────────────────────────────────────────────────────

async function seedTwoUsers(db: Db): Promise<void> {
  await db.insert(user).values([
    { id: USER, name: "User One", email: "u1@example.com" },
    { id: OTHER_USER, name: "User Two", email: "u2@example.com" },
  ]);
}

async function seedClient(
  db: Db,
  clientId: string,
  fields: { ownerUserId: string | null; name: string | null },
): Promise<void> {
  await db.insert(oauthClient).values({
    id: `client-row-${clientId}`,
    clientId,
    name: fields.name,
    redirectUris: [],
    userId: fields.ownerUserId,
  });
}

async function seedConsent(
  db: Db,
  userId: string,
  clientId: string,
  scopes: string[],
  createdAtEpoch: number,
): Promise<void> {
  await db.insert(oauthConsent).values({
    id: `consent-${userId}-${clientId}`,
    clientId,
    userId,
    scopes,
    createdAt: new Date(createdAtEpoch),
    updatedAt: new Date(createdAtEpoch),
  });
}

async function seedAccessToken(
  db: Db,
  userId: string,
  clientId: string,
  createdAtEpoch: number,
): Promise<void> {
  await db.insert(oauthAccessToken).values({
    id: `at-${userId}-${clientId}-${createdAtEpoch}`,
    token: `tok-${userId}-${clientId}-${createdAtEpoch}`,
    clientId,
    userId,
    expiresAt: new Date(createdAtEpoch + 3_600_000),
    createdAt: new Date(createdAtEpoch),
    scopes: [],
  });
}

async function seedRefreshToken(db: Db, userId: string, clientId: string): Promise<void> {
  await db.insert(oauthRefreshToken).values({
    id: `rt-${userId}-${clientId}`,
    token: `rtok-${userId}-${clientId}`,
    clientId,
    userId,
    expiresAt: new Date(Date.now() + 86_400_000),
    createdAt: new Date(),
    scopes: [],
  });
}
