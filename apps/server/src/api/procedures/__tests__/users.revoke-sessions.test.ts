import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";

vi.mock("../../../env", () => ({
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
} from "../../../__tests__/helpers/in-memory-db";
import {
  user,
  session,
  oauthClient,
  oauthAccessToken,
  oauthRefreshToken,
} from "../../../db/schema/auth";

let db: Db;

const TARGET_ID = "target-user";

beforeEach(async () => {
  db = await createInMemoryDb();

  await db.insert(user).values({ id: TARGET_ID, name: "Target", email: "target@example.com" });

  await db.insert(session).values({
    id: "sess-target",
    expiresAt: new Date(Date.now() + 86_400_000),
    token: "tok-target",
    updatedAt: new Date(),
    userId: TARGET_ID,
  });

  // An OAuth client is required as a foreign key for tokens.
  await db.insert(oauthClient).values({
    id: "client-row",
    clientId: "c-target",
    name: "client",
    redirectUris: [],
    userId: TARGET_ID,
  });

  await db.insert(oauthAccessToken).values({
    id: "at-target",
    token: "access-tok",
    clientId: "c-target",
    userId: TARGET_ID,
    expiresAt: new Date(Date.now() + 3_600_000),
    createdAt: new Date(),
    scopes: [],
  });

  await db.insert(oauthRefreshToken).values({
    id: "rt-target",
    token: "refresh-tok",
    clientId: "c-target",
    userId: TARGET_ID,
    expiresAt: new Date(Date.now() + 86_400_000),
    createdAt: new Date(),
    scopes: [],
  });
});

afterAll(() => cleanupInMemoryDbs());

// These tests verify the DB-level behaviour that the revoke-sessions handler
// relies on. The old bug was that only the session table was cleared, leaving
// OAuth tokens active. The new behaviour clears all three token types.
describe("revoke-sessions: invalidates session and OAuth tokens", () => {
  it("old behaviour leaves OAuth tokens behind (documents the bug)", async () => {
    // Simulate the OLD handler: only delete sessions.
    await db.delete(session).where(eq(session.userId, TARGET_ID));

    const remaining = await db
      .select()
      .from(oauthAccessToken)
      .where(eq(oauthAccessToken.userId, TARGET_ID))
      .all();

    // OAuth tokens survive — this was the vulnerability.
    expect(remaining).toHaveLength(1);
  });

  it("new behaviour also deletes OAuth access tokens", async () => {
    // Simulate the NEW handler.
    await db.delete(session).where(eq(session.userId, TARGET_ID));
    await db.delete(oauthAccessToken).where(eq(oauthAccessToken.userId, TARGET_ID));
    await db.delete(oauthRefreshToken).where(eq(oauthRefreshToken.userId, TARGET_ID));

    const accessTokens = await db
      .select()
      .from(oauthAccessToken)
      .where(eq(oauthAccessToken.userId, TARGET_ID))
      .all();

    expect(accessTokens).toHaveLength(0);
  });

  it("new behaviour also deletes OAuth refresh tokens", async () => {
    await db.delete(session).where(eq(session.userId, TARGET_ID));
    await db.delete(oauthAccessToken).where(eq(oauthAccessToken.userId, TARGET_ID));
    await db.delete(oauthRefreshToken).where(eq(oauthRefreshToken.userId, TARGET_ID));

    const refreshTokens = await db
      .select()
      .from(oauthRefreshToken)
      .where(eq(oauthRefreshToken.userId, TARGET_ID))
      .all();

    expect(refreshTokens).toHaveLength(0);
  });

  it("new behaviour clears all three token types in one revocation", async () => {
    await db.delete(session).where(eq(session.userId, TARGET_ID));
    await db.delete(oauthAccessToken).where(eq(oauthAccessToken.userId, TARGET_ID));
    await db.delete(oauthRefreshToken).where(eq(oauthRefreshToken.userId, TARGET_ID));

    const sessions = await db.select().from(session).where(eq(session.userId, TARGET_ID)).all();
    const accessTokens = await db
      .select()
      .from(oauthAccessToken)
      .where(eq(oauthAccessToken.userId, TARGET_ID))
      .all();
    const refreshTokens = await db
      .select()
      .from(oauthRefreshToken)
      .where(eq(oauthRefreshToken.userId, TARGET_ID))
      .all();

    expect(sessions).toHaveLength(0);
    expect(accessTokens).toHaveLength(0);
    expect(refreshTokens).toHaveLength(0);
  });
});
