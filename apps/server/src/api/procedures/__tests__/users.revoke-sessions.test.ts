import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
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
import { errorHandler, requestContextMiddleware } from "../../../diagnostics/middleware";
import { unauthorized } from "../../../diagnostics/http-errors";

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

let db: Db;
let mockUserId: string | null = null;

vi.mock("../../../db/client", () => ({
  getDb: () => db,
}));

vi.mock("../../../auth", async () => {
  const { PERMISSIONS } = await import("@ent-mcp/shared/auth");
  return {
    requireSession: async (c: any, next: any) => {
      if (!mockUserId) throw unauthorized();
      c.set("session", { user: { id: mockUserId } });
      await next();
    },
    sessionUserId: (c: any) => {
      const session = c.get("session") as { user: { id: string } } | undefined;
      if (!session) throw unauthorized();
      return session.user.id;
    },
    requirePermission: () => async (_c: any, next: any) => {
      await next();
    },
    auth: { api: {} },
    PERMISSIONS,
  };
});

const { adminUsersApp } = await import("../users");

function buildApp() {
  return new Hono()
    .use("*", requestContextMiddleware())
    .route("/admin/users", adminUsersApp)
    .onError(errorHandler);
}

const ADMIN_ID = "admin-user";
const TARGET_ID = "target-user";

async function seedTargetWithTokens() {
  await db.insert(user).values({ id: ADMIN_ID, name: "Admin", email: "admin@example.com" });
  await db.insert(user).values({ id: TARGET_ID, name: "Target", email: "target@example.com" });

  await db.insert(session).values({
    id: "sess-target",
    expiresAt: new Date(Date.now() + 86_400_000),
    token: "tok-target",
    updatedAt: new Date(),
    userId: TARGET_ID,
  });

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
}

beforeEach(async () => {
  db = await createInMemoryDb();
  mockUserId = null;
});

afterAll(() => cleanupInMemoryDbs());

describe("POST /admin/users/:id/revoke-sessions", () => {
  it("clears sessions, OAuth access tokens, and OAuth refresh tokens for the target user", async () => {
    mockUserId = ADMIN_ID;
    await seedTargetWithTokens();

    const res = await buildApp().request(`/admin/users/${TARGET_ID}/revoke-sessions`, {
      method: "POST",
    });

    expect(res.status).toBe(200);

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

  it("returns 400 when an admin attempts to revoke their own sessions", async () => {
    mockUserId = ADMIN_ID;
    await seedTargetWithTokens();

    const res = await buildApp().request(`/admin/users/${ADMIN_ID}/revoke-sessions`, {
      method: "POST",
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toContain("users.self_revoke");
  });

  it("returns 404 when the target user does not exist", async () => {
    mockUserId = ADMIN_ID;
    await db.insert(user).values({ id: ADMIN_ID, name: "Admin", email: "admin@example.com" });

    const res = await buildApp().request(`/admin/users/no-such-user/revoke-sessions`, {
      method: "POST",
    });

    expect(res.status).toBe(404);
  });

  it("leaves other users' sessions and tokens untouched", async () => {
    mockUserId = ADMIN_ID;
    await seedTargetWithTokens();

    const OTHER_ID = "other-user";
    await db.insert(user).values({ id: OTHER_ID, name: "Other", email: "other@example.com" });
    await db.insert(session).values({
      id: "sess-other",
      expiresAt: new Date(Date.now() + 86_400_000),
      token: "tok-other",
      updatedAt: new Date(),
      userId: OTHER_ID,
    });
    await db.insert(oauthClient).values({
      id: "client-other-row",
      clientId: "c-other",
      name: "client-other",
      redirectUris: [],
      userId: OTHER_ID,
    });
    await db.insert(oauthAccessToken).values({
      id: "at-other",
      token: "access-other",
      clientId: "c-other",
      userId: OTHER_ID,
      expiresAt: new Date(Date.now() + 3_600_000),
      createdAt: new Date(),
      scopes: [],
    });

    const res = await buildApp().request(`/admin/users/${TARGET_ID}/revoke-sessions`, {
      method: "POST",
    });
    expect(res.status).toBe(200);

    const otherSessions = await db.select().from(session).where(eq(session.userId, OTHER_ID)).all();
    const otherAccessTokens = await db
      .select()
      .from(oauthAccessToken)
      .where(eq(oauthAccessToken.userId, OTHER_ID))
      .all();
    expect(otherSessions).toHaveLength(1);
    expect(otherAccessTokens).toHaveLength(1);
  });
});
