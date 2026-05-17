import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../__tests__/helpers/in-memory-db";
import { errorRecords, perfRecords } from "../../db/schema/diagnostics";

vi.mock("../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

let db: Db;
vi.mock("../../db/client", () => ({
  getDb: () => db,
}));

const { DatabaseSink } = await import("../database-sink");

afterAll(() => cleanupInMemoryDbs());

beforeEach(async () => {
  db = await createInMemoryDb();
});

describe("DatabaseSink — system user sentinel", () => {
  it("stores null user_id for __system__ perf records", async () => {
    const sink = new DatabaseSink();
    await sink.capturePerf({
      id: "perf-1",
      requestId: "req-1",
      kind: "plugin",
      durationMs: 120,
      route: "discover",
      method: null,
      status: null,
      pluginId: null,
      userId: "__system__",
      createdAt: Date.now(),
    });
    const row = await db.select().from(perfRecords).where(eq(perfRecords.id, "perf-1")).get();
    expect(row).toBeDefined();
    expect(row!.userId).toBeNull();
  });

  it("stores null user_id for __system__ error records", async () => {
    const sink = new DatabaseSink();
    await sink.captureError({
      id: "err-1",
      requestId: "req-2",
      severity: "error",
      source: "plugin",
      code: "plugin.upstream_error",
      devMessage: "upstream failed",
      stack: null,
      userId: "__system__",
      pluginId: null,
      connectionId: null,
      route: null,
      httpStatus: null,
      context: null,
      createdAt: Date.now(),
    });
    const row = await db.select().from(errorRecords).where(eq(errorRecords.id, "err-1")).get();
    expect(row).toBeDefined();
    expect(row!.userId).toBeNull();
  });

  it("preserves real user_id values", async () => {
    const sink = new DatabaseSink();
    await sink.capturePerf({
      id: "perf-2",
      requestId: "req-3",
      kind: "http",
      durationMs: 50,
      route: "/api/home",
      method: "GET",
      status: 200,
      pluginId: null,
      userId: null,
      createdAt: Date.now(),
    });
    const row = await db.select().from(perfRecords).where(eq(perfRecords.id, "perf-2")).get();
    expect(row).toBeDefined();
    expect(row!.userId).toBeNull();
  });
});
