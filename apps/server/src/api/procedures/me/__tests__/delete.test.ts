import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";

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

const { verifyPassword } = vi.hoisted(() => ({ verifyPassword: vi.fn() }));

vi.mock("../../../../auth", () => ({
  auth: { api: { verifyPassword } },
}));

import { deleteAccount } from "../delete";
import {
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
  session,
  user,
} from "../../../../db/schema/auth";
import { serviceConnections } from "../../../../db/schema/plugin-runtime/credentials";
import { feedback } from "../../../../db/schema/preferences/feedback";
import { jobRuns } from "../../../../db/schema/infra/jobs";
import { plugins } from "../../../../db/schema/plugin-runtime/plugins";
import { preferenceProfiles } from "../../../../db/schema/preferences";
import { roles, userRoles } from "../../../../db/schema/auth/roles";
import { primaryConnections } from "../../../../db/schema/preferences/user-preferences";

const USER = "victim";
const SURVIVOR = "survivor";

let db: Db;

beforeEach(async () => {
  db = await createInMemoryDb();
  verifyPassword.mockReset();
  await db.insert(user).values([
    { id: USER, name: "V", email: "victim@example.com" },
    { id: SURVIVOR, name: "S", email: "survivor@example.com" },
  ]);
});

afterAll(() => cleanupInMemoryDbs());

describe("deleteAccount", () => {
  it("removes the user and cascades every user-scoped row, while preserving SET-NULL history", async () => {
    verifyPassword.mockResolvedValue({ status: true });

    await seedFullUserGraph(db, USER);
    await seedJobHistory(db, USER);

    await deleteAccount(db, {
      userId: USER,
      confirmEmail: "victim@example.com",
      currentPassword: "secret",
      headers: new Headers(),
    });

    expect(verifyPassword).toHaveBeenCalledWith({
      body: { password: "secret" },
      headers: expect.any(Headers),
    });

    await assertNoOrphans(db, USER);
    await assertJobHistorySurvivedAnonymously(db, USER);
    await assertSurvivorUntouched(db);
  });

  it("rejects with 401 when the password is wrong", async () => {
    verifyPassword.mockRejectedValue(new Error("Invalid password"));

    await expect(
      deleteAccount(db, {
        userId: USER,
        confirmEmail: "victim@example.com",
        currentPassword: "wrong",
        headers: new Headers(),
      }),
    ).rejects.toMatchObject({ status: 401, code: "me.delete.invalid_password" });

    const stillThere = await db.select().from(user).where(eq(user.id, USER)).get();
    expect(stillThere).toBeDefined();
  });

  it("rejects with 401 when verifyPassword resolves to { status: false }", async () => {
    verifyPassword.mockResolvedValue({ status: false });

    await expect(
      deleteAccount(db, {
        userId: USER,
        confirmEmail: "victim@example.com",
        currentPassword: "wrong",
        headers: new Headers(),
      }),
    ).rejects.toMatchObject({ status: 401, code: "me.delete.invalid_password" });

    const stillThere = await db.select().from(user).where(eq(user.id, USER)).get();
    expect(stillThere).toBeDefined();
  });

  it("rejects with 400 when the email confirmation does not match", async () => {
    verifyPassword.mockResolvedValue({ status: true });

    await expect(
      deleteAccount(db, {
        userId: USER,
        confirmEmail: "wrong@example.com",
        currentPassword: "secret",
        headers: new Headers(),
      }),
    ).rejects.toMatchObject({ status: 400, code: "me.delete.email_mismatch" });

    const stillThere = await db.select().from(user).where(eq(user.id, USER)).get();
    expect(stillThere).toBeDefined();
  });

  it("rejects with 401 when verifyPassword resolves to {} (fail-closed guard)", async () => {
    verifyPassword.mockResolvedValue({});

    await expect(
      deleteAccount(db, {
        userId: USER,
        confirmEmail: "victim@example.com",
        currentPassword: "secret",
        headers: new Headers(),
      }),
    ).rejects.toMatchObject({ status: 401, code: "me.delete.invalid_password" });

    const stillThere = await db.select().from(user).where(eq(user.id, USER)).get();
    expect(stillThere).toBeDefined();
  });

  it("rejects with 401 when verifyPassword resolves to { user: {} } (fail-closed guard)", async () => {
    verifyPassword.mockResolvedValue({ user: {} });

    await expect(
      deleteAccount(db, {
        userId: USER,
        confirmEmail: "victim@example.com",
        currentPassword: "secret",
        headers: new Headers(),
      }),
    ).rejects.toMatchObject({ status: 401, code: "me.delete.invalid_password" });

    const stillThere = await db.select().from(user).where(eq(user.id, USER)).get();
    expect(stillThere).toBeDefined();
  });

  it("rejects with 401 when verifyPassword resolves to { valid: true } (phantom shape, fail-closed)", async () => {
    verifyPassword.mockResolvedValue({ valid: true });

    await expect(
      deleteAccount(db, {
        userId: USER,
        confirmEmail: "victim@example.com",
        currentPassword: "secret",
        headers: new Headers(),
      }),
    ).rejects.toMatchObject({ status: 401, code: "me.delete.invalid_password" });

    const stillThere = await db.select().from(user).where(eq(user.id, USER)).get();
    expect(stillThere).toBeDefined();
  });

  it("matches email case-insensitively", async () => {
    verifyPassword.mockResolvedValue({ status: true });

    await deleteAccount(db, {
      userId: USER,
      confirmEmail: "VICTIM@EXAMPLE.COM",
      currentPassword: "secret",
      headers: new Headers(),
    });

    const stillThere = await db.select().from(user).where(eq(user.id, USER)).get();
    expect(stillThere).toBeUndefined();
  });
});

// ─── seeds ────────────────────────────────────────────────────────────────────

async function seedFullUserGraph(db: Db, userId: string): Promise<void> {
  await db.insert(session).values({
    id: `s-${userId}`,
    expiresAt: new Date(Date.now() + 86_400_000),
    token: `session-tok-${userId}`,
    updatedAt: new Date(),
    userId,
  });

  await db.insert(oauthClient).values({
    id: `client-row-${userId}`,
    clientId: `c-${userId}`,
    name: "client",
    redirectUris: [],
    userId,
  });

  await db.insert(oauthConsent).values({
    id: `consent-${userId}`,
    clientId: `c-${userId}`,
    userId,
    scopes: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await db.insert(oauthAccessToken).values({
    id: `at-${userId}`,
    token: `tok-${userId}`,
    clientId: `c-${userId}`,
    userId,
    expiresAt: new Date(Date.now() + 3_600_000),
    createdAt: new Date(),
    scopes: [],
  });

  await db.insert(oauthRefreshToken).values({
    id: `rt-${userId}`,
    token: `rtok-${userId}`,
    clientId: `c-${userId}`,
    userId,
    expiresAt: new Date(Date.now() + 86_400_000),
    createdAt: new Date(),
    scopes: [],
  });

  await db.insert(roles).values({
    id: `role-for-${userId}`,
    name: `role-${userId}`,
    createdAt: 0,
    updatedAt: 0,
  });
  await db.insert(userRoles).values({ userId, roleId: `role-for-${userId}`, assignedAt: 0 });

  await db.insert(feedback).values({
    id: `fb-${userId}`,
    userId,
    tmdbId: "movie-1",
    mediaType: "movie",
    action: "like",
    createdAt: 0,
  });

  await db.insert(preferenceProfiles).values({
    userId,
    mediaType: "movie",
    features: "{}",
    sampleSize: 0,
    confidence: "low",
    lastRebuiltAt: 0,
    lastUpdatedAt: 0,
  });

  await db.insert(plugins).values({
    id: `plugin-${userId}`,
    version: "1.0.0",
    sourceUrl: "https://example.test/plugin",
    sourceType: "url",
    checksum: "deadbeef",
    manifest: "{}",
    installedAt: 0,
    updatedAt: 0,
  });

  await db.insert(serviceConnections).values({
    id: `sc-${userId}`,
    userId,
    pluginId: `plugin-${userId}`,
    status: "connected",
    createdAt: 0,
    updatedAt: 0,
  });

  await db.insert(primaryConnections).values({
    userId,
    capabilityKey: "metadata@v1",
    mediaType: "movie",
    connectionId: `sc-${userId}`,
    updatedAt: 0,
  });
}

async function seedJobHistory(db: Db, userId: string): Promise<void> {
  await db.insert(jobRuns).values({
    id: `jr-${userId}`,
    jobId: "test-job",
    status: "succeeded",
    triggeredBy: "user",
    triggeredByUserId: userId,
    startedAt: 1,
    requestId: "req-1",
  });
}

async function assertNoOrphans(db: Db, userId: string): Promise<void> {
  expect(await db.select().from(user).where(eq(user.id, userId)).get()).toBeUndefined();
  expect(await db.select().from(session).where(eq(session.userId, userId)).all()).toHaveLength(0);
  expect(
    await db.select().from(oauthAccessToken).where(eq(oauthAccessToken.userId, userId)).all(),
  ).toHaveLength(0);
  expect(
    await db.select().from(oauthRefreshToken).where(eq(oauthRefreshToken.userId, userId)).all(),
  ).toHaveLength(0);
  expect(
    await db.select().from(oauthConsent).where(eq(oauthConsent.userId, userId)).all(),
  ).toHaveLength(0);
  expect(
    await db.select().from(oauthClient).where(eq(oauthClient.userId, userId)).all(),
  ).toHaveLength(0);
  expect(await db.select().from(userRoles).where(eq(userRoles.userId, userId)).all()).toHaveLength(
    0,
  );
  expect(await db.select().from(feedback).where(eq(feedback.userId, userId)).all()).toHaveLength(0);
  expect(
    await db.select().from(preferenceProfiles).where(eq(preferenceProfiles.userId, userId)).all(),
  ).toHaveLength(0);
  expect(
    await db.select().from(serviceConnections).where(eq(serviceConnections.userId, userId)).all(),
  ).toHaveLength(0);
  expect(
    await db.select().from(primaryConnections).where(eq(primaryConnections.userId, userId)).all(),
  ).toHaveLength(0);
}

async function assertJobHistorySurvivedAnonymously(db: Db, userId: string): Promise<void> {
  const job = await db
    .select()
    .from(jobRuns)
    .where(eq(jobRuns.id, `jr-${userId}`))
    .get();
  expect(job).toBeDefined();
  expect(job?.triggeredByUserId).toBeNull();
}

async function assertSurvivorUntouched(db: Db): Promise<void> {
  const row = await db.select().from(user).where(eq(user.id, SURVIVOR)).get();
  expect(row).toBeDefined();
  expect(row?.email).toBe("survivor@example.com");
}
