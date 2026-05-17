import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { and, eq } from "drizzle-orm";

vi.mock("../../env", () => ({
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
} from "../../__tests__/helpers/in-memory-db";
import { notificationSubscriptions } from "../../db/schema/notifications";
import { serviceConnections } from "../../db/schema/credentials";
import { user } from "../../db/schema/auth";
import { plugins } from "../../db/schema/plugins";

let db: Db;

vi.mock("../../db/client", () => ({
  getDb: () => db,
}));

vi.mock("../../crypto/helpers", () => ({
  encryptJson: async (value: unknown) => ({
    iv: "iv",
    data: Buffer.from(JSON.stringify(value)).toString("base64"),
  }),
}));

const { emitMock } = vi.hoisted(() => ({
  emitMock: vi.fn<(event: unknown) => Promise<void>>(async () => undefined),
}));
vi.mock("../emit", () => ({ emit: emitMock }));

let registeredHandler: ((ctx: unknown, input: unknown) => Promise<unknown>) | null = null;

vi.mock("../../jobs/triggerable", () => ({
  registerTriggerable: (opts: { handler: (ctx: unknown, input: unknown) => Promise<unknown> }) => {
    registeredHandler = opts.handler;
    return { id: "host.notifications.demo" };
  },
}));

const { registerDemoNotificationJob } = await import("../demo-job");

async function runDemo(input: unknown) {
  if (!registeredHandler) throw new Error("handler not registered");
  return registeredHandler({}, input);
}

async function seedUser(id: string) {
  const now = new Date();
  await db.insert(user).values({
    id,
    name: id,
    email: `${id}@example.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
}

async function seedInboxPlugin() {
  await db.insert(plugins).values({
    id: "inbox",
    version: "0.2.0",
    sourceUrl: "builtin:inbox",
    sourceType: "builtin",
    checksum: "x",
    manifest: "{}",
    enabled: 1,
    installedAt: Date.now(),
    updatedAt: Date.now(),
  });
}

beforeEach(async () => {
  db = await createInMemoryDb();
  emitMock.mockReset();
  registeredHandler = null;
  await seedInboxPlugin();
  await seedUser("user-1");
  await seedUser("user-2");
  await seedUser("user-3");
  await seedUser("u");
  registerDemoNotificationJob();
});

afterAll(() => {
  cleanupInMemoryDbs();
});

describe("registerDemoNotificationJob", () => {
  it("derives category from event type and seeds subscription for it", async () => {
    await runDemo({ userId: "user-1", eventType: "connection.auth.expired" });
    const conn = await db
      .select()
      .from(serviceConnections)
      .where(and(eq(serviceConnections.userId, "user-1"), eq(serviceConnections.pluginId, "inbox")))
      .get();
    expect(conn).toBeTruthy();
    const sub = await db
      .select()
      .from(notificationSubscriptions)
      .where(eq(notificationSubscriptions.connectionId, conn!.id))
      .get();
    expect(sub).toMatchObject({ category: "auth", enabled: 1 });
  });

  it("reuses existing inbox connection on subsequent runs", async () => {
    await runDemo({ userId: "user-2" });
    await runDemo({ userId: "user-2" });
    const conns = await db
      .select()
      .from(serviceConnections)
      .where(and(eq(serviceConnections.userId, "user-2"), eq(serviceConnections.pluginId, "inbox")))
      .all();
    expect(conns).toHaveLength(1);
  });

  it("emits a media.request.available event by default", async () => {
    await runDemo({ userId: "user-3" });
    expect(emitMock).toHaveBeenCalledTimes(1);
    expect(emitMock.mock.calls[0]![0]).toMatchObject({
      type: "media.request.available",
      category: "media",
      severity: "info",
      audience: { kind: "user", userId: "user-3" },
    });
  });

  it("emits the chosen event type with matching category and severity (auth)", async () => {
    await runDemo({ userId: "user-3", eventType: "connection.auth.expired" });
    expect(emitMock.mock.calls[0]![0]).toMatchObject({
      type: "connection.auth.expired",
      category: "auth",
      severity: "warn",
      audience: { kind: "user", userId: "user-3" },
      payload: { connectionId: "demo-connection", pluginId: "demo-plugin" },
    });
  });

  it("emits system.error correctly when chosen", async () => {
    await runDemo({ userId: "user-3", eventType: "system.error" });
    expect(emitMock.mock.calls[0]![0]).toMatchObject({
      type: "system.error",
      category: "system",
      severity: "error",
      payload: { errorSource: "demo" },
    });
  });

  it("rejects missing userId", async () => {
    await expect(runDemo({})).rejects.toThrow(/userId/);
  });

  it("rejects unknown event type", async () => {
    await expect(runDemo({ userId: "u", eventType: "bogus.event" })).rejects.toThrow(
      /eventType must be one of/,
    );
  });

  it("does not re-enable a category the user has disabled", async () => {
    await runDemo({ userId: "user-1", eventType: "media.request.available" });
    const conn = await db
      .select()
      .from(serviceConnections)
      .where(and(eq(serviceConnections.userId, "user-1"), eq(serviceConnections.pluginId, "inbox")))
      .get();
    await db
      .update(notificationSubscriptions)
      .set({ enabled: 0 })
      .where(
        and(
          eq(notificationSubscriptions.connectionId, conn!.id),
          eq(notificationSubscriptions.category, "media"),
        ),
      );
    await runDemo({ userId: "user-1", eventType: "media.request.available" });
    const sub = await db
      .select()
      .from(notificationSubscriptions)
      .where(eq(notificationSubscriptions.connectionId, conn!.id))
      .get();
    expect(sub).toMatchObject({ enabled: 0 });
  });

  it("seeds the inbox connection without overriding existing default", async () => {
    await runDemo({ userId: "user-1" });
    const conn = await db
      .select()
      .from(serviceConnections)
      .where(and(eq(serviceConnections.userId, "user-1"), eq(serviceConnections.pluginId, "inbox")))
      .get();
    expect(conn).toMatchObject({ isDefault: 0 });
  });
});
