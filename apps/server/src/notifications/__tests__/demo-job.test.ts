import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { and, eq } from "drizzle-orm";
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

const emitMock = vi.fn<(event: unknown) => Promise<void>>(async () => undefined);
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
  it("creates inbox connection when missing and enables subscription for chosen category", async () => {
    await runDemo({ userId: "user-1", category: "media" });
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
    expect(sub).toMatchObject({ category: "media", enabled: 1 });
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

  it("emits a media.request.available event for the recipient user", async () => {
    await runDemo({ userId: "user-3", title: "Hello demo" });
    expect(emitMock).toHaveBeenCalledTimes(1);
    expect(emitMock.mock.calls[0]![0]).toMatchObject({
      type: "media.request.available",
      category: "media",
      audience: { kind: "user", userId: "user-3" },
      payload: { title: "Hello demo" },
    });
  });

  it("rejects missing userId", async () => {
    await expect(runDemo({})).rejects.toThrow(/userId/);
  });

  it("rejects unknown category", async () => {
    await expect(runDemo({ userId: "u", category: "bogus" })).rejects.toThrow();
  });
});
