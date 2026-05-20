import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { and, eq, isNull } from "drizzle-orm";
import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../__tests__/helpers/in-memory-db";
import { user } from "../../db/schema/auth";
import { plugins, pluginStore } from "../../db/schema/plugin-runtime/plugins";

vi.mock("../../env", () => ({
  env: { ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef" },
}));

let db: Db;
vi.mock("../../db/client", () => ({ getDb: () => db }));

const { buildStore, sweepExpiredStore } = await import("../internal/host-bridge");

const PLUGIN_ID = "tmdb";

async function seedUser(id: string): Promise<void> {
  await db.insert(user).values({
    id,
    name: id,
    email: `${id}@test`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

beforeAll(async () => {
  db = await createInMemoryDb();
  await db.insert(plugins).values({
    id: PLUGIN_ID,
    version: "0.0.0",
    sourceUrl: "https://example.invalid/tmdb",
    sourceType: "builtin",
    checksum: "sha256:0",
    manifest: "{}",
    installedAt: Date.now(),
    updatedAt: Date.now(),
  });
  await seedUser("user-1");
  await seedUser("user-a");
  await seedUser("user-b");
});

afterAll(() => cleanupInMemoryDbs());

beforeEach(async () => {
  await db.delete(pluginStore);
});

describe("buildStore", () => {
  it("roundtrips a JSON value within the same scope", async () => {
    const store = buildStore(PLUGIN_ID, "user-1");
    await store.set("session", { token: "abc" });
    await expect(store.get("session")).resolves.toEqual({ token: "abc" });
  });

  it("returns undefined for a missing key instead of throwing", async () => {
    const store = buildStore(PLUGIN_ID, "user-1");
    await expect(store.get("missing")).resolves.toBeUndefined();
  });

  it("returns undefined once a TTL has elapsed", async () => {
    const store = buildStore(PLUGIN_ID, "user-1");
    await store.set("t", { n: 1 }, { ttlSec: 10 });
    // Force the stored row into the past without waiting on real time.
    await db
      .update(pluginStore)
      .set({ expiresAt: Date.now() - 1 })
      .where(eq(pluginStore.key, "t"));
    await expect(store.get("t")).resolves.toBeUndefined();
  });

  it("isolates user-scoped entries by userId", async () => {
    const a = buildStore(PLUGIN_ID, "user-a");
    const b = buildStore(PLUGIN_ID, "user-b");
    await a.set("k", { who: "a" });
    await b.set("k", { who: "b" });
    await expect(a.get("k")).resolves.toEqual({ who: "a" });
    await expect(b.get("k")).resolves.toEqual({ who: "b" });
  });

  it("separates global scope from user scope even under the same caller", async () => {
    const store = buildStore(PLUGIN_ID, "user-1");
    await store.set("k", { who: "user" });
    await store.set("k", { who: "global" }, { scope: "global" });
    await expect(store.get("k")).resolves.toEqual({ who: "user" });
    await expect(store.get("k", { scope: "global" })).resolves.toEqual({ who: "global" });
  });

  it("delete with scope=global removes the global row without touching user rows", async () => {
    const store = buildStore(PLUGIN_ID, "user-1");
    await store.set("k", { who: "user" });
    await store.set("k", { who: "global" }, { scope: "global" });
    await store.delete("k", { scope: "global" });
    await expect(store.get("k", { scope: "global" })).resolves.toBeUndefined();
    await expect(store.get("k")).resolves.toEqual({ who: "user" });
  });

  it("overwrites an existing user-scoped value instead of inserting a duplicate row", async () => {
    const store = buildStore(PLUGIN_ID, "user-1");
    await store.set("k", { v: 1 });
    await store.set("k", { v: 2 });
    const stored = await db
      .select()
      .from(pluginStore)
      .where(and(eq(pluginStore.pluginId, PLUGIN_ID), eq(pluginStore.userId, "user-1")));
    expect(stored).toHaveLength(1);
    await expect(store.get("k")).resolves.toEqual({ v: 2 });
  });

  it("overwrites an existing global-scope value instead of inserting a duplicate row", async () => {
    // Regression: SQLite treats NULL as distinct in unique/PK indexes, so a
    // bare ON CONFLICT upsert never matched the existing NULL-userId row and
    // duplicates accumulated for every store.set under scope=global.
    const store = buildStore(PLUGIN_ID, "user-1");
    await store.set("k", { v: 1 }, { scope: "global" });
    await store.set("k", { v: 2 }, { scope: "global" });
    const stored = await db
      .select()
      .from(pluginStore)
      .where(and(eq(pluginStore.pluginId, PLUGIN_ID), isNull(pluginStore.userId)));
    expect(stored).toHaveLength(1);
    await expect(store.get("k", { scope: "global" })).resolves.toEqual({ v: 2 });
  });
});

describe("sweepExpiredStore", () => {
  it("deletes only rows whose expiresAt is in the past", async () => {
    const store = buildStore(PLUGIN_ID, "user-1");
    await store.set("fresh", { n: 1 }, { ttlSec: 3600 });
    await store.set("stale", { n: 2 }, { ttlSec: 3600 });
    await store.set("noTtl", { n: 3 });
    // Age the "stale" entry out of the window.
    await db
      .update(pluginStore)
      .set({ expiresAt: Date.now() - 1 })
      .where(eq(pluginStore.key, "stale"));

    const deleted = await sweepExpiredStore();
    expect(deleted).toBe(1);
    const remaining = await db.select({ key: pluginStore.key }).from(pluginStore);
    expect(remaining.map((r) => r.key).sort()).toEqual(["fresh", "noTtl"]);
  });
});
