import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../__tests__/helpers/in-memory-db";
import {
  appConfig,
  errorRecords,
  perfRecords,
  sourcemaps,
} from "../../db/schema/infra/diagnostics";

vi.mock("../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

let db: Db;
vi.mock("../../db/client", () => ({
  getDb: () => db,
}));

const {
  sweepDiagnostics,
  setErrorRetentionDays,
  setPerfRetentionDays,
  getAppConfig,
  getNotificationRetention,
  setNotificationRetention,
} = await import("../retention");

const DAY_MS = 24 * 60 * 60 * 1000;

afterAll(() => cleanupInMemoryDbs());

beforeEach(async () => {
  db = await createInMemoryDb();
});

async function insertError(id: string, ageDays: number): Promise<void> {
  await db.insert(errorRecords).values({
    id,
    requestId: `req-${id}`,
    severity: "error",
    source: "backend",
    devMessage: "boom",
    createdAt: Date.now() - ageDays * DAY_MS,
  });
}

async function insertPerf(id: string, ageDays: number): Promise<void> {
  await db.insert(perfRecords).values({
    id,
    requestId: `req-${id}`,
    kind: "http",
    durationMs: 100,
    createdAt: Date.now() - ageDays * DAY_MS,
  });
}

/** Mirrors the production constant in `retention.ts`; the prune keeps maps for
 *  this many most-recently-active builds. */
const RETAINED_BUILDS = 50;

/** Inserts one map for `buildId` whose `createdAt` encodes its activity recency
 *  (smaller `ageDays` = more recent). */
async function insertMap(buildId: string, ageDays: number): Promise<void> {
  await db.insert(sourcemaps).values({
    id: `map-${buildId}`,
    buildId,
    fileName: `index-${buildId}.js`,
    content: '{"version":3,"mappings":"AAAA"}',
    createdAt: Date.now() - ageDays * DAY_MS,
  });
}

async function remainingBuildIds(): Promise<string[]> {
  const rows = await db.select({ buildId: sourcemaps.buildId }).from(sourcemaps).all();
  return rows.map((r) => r.buildId).sort();
}

describe("retention sweep", () => {
  it("deletes rows older than each retention window in both tables", async () => {
    // Seed config: 30d errors, 7d perf (defaults).
    await getAppConfig();

    await insertError("err-fresh", 1);
    await insertError("err-edge", 29);
    await insertError("err-old", 35);
    await insertPerf("perf-fresh", 0.5);
    await insertPerf("perf-edge", 6);
    await insertPerf("perf-old", 10);

    const result = await sweepDiagnostics();

    expect(result.errors).toBe(1);
    expect(result.perf).toBe(1);

    const errs = await db.select({ id: errorRecords.id }).from(errorRecords).all();
    expect(errs.map((r) => r.id).sort()).toEqual(["err-edge", "err-fresh"]);

    const perfs = await db.select({ id: perfRecords.id }).from(perfRecords).all();
    expect(perfs.map((r) => r.id).sort()).toEqual(["perf-edge", "perf-fresh"]);
  });

  it("uses tightened windows after setErrorRetentionDays / setPerfRetentionDays", async () => {
    await setErrorRetentionDays(7);
    await setPerfRetentionDays(1);

    await insertError("err-1d", 1);
    await insertError("err-10d", 10);
    await insertPerf("perf-12h", 0.5);
    await insertPerf("perf-3d", 3);

    const result = await sweepDiagnostics();

    expect(result.errors).toBe(1);
    expect(result.perf).toBe(1);

    const cfg = await db.select().from(appConfig).where(eq(appConfig.id, "global")).get();
    expect(cfg?.errorRetentionDays).toBe(7);
    expect(cfg?.perfRetentionDays).toBe(1);
  });

  it("clamps retention values to the documented bounds", async () => {
    expect(await setErrorRetentionDays(0)).toBe(7);
    expect(await setErrorRetentionDays(9999)).toBe(365);
    expect(await setPerfRetentionDays(0)).toBe(1);
    expect(await setPerfRetentionDays(9999)).toBe(90);
  });

  it("is a no-op when nothing is past the windows", async () => {
    await getAppConfig();
    await insertError("err-fresh", 0.1);
    await insertPerf("perf-fresh", 0.1);

    const result = await sweepDiagnostics();
    expect(result).toEqual({ errors: 0, perf: 0, sourcemaps: 0 });
  });

  // Regression guard for the WHERE clause added in #693: without it a rogue
  // second row in app_config could shadow the 'global' values silently.
  it("getAppConfig ignores a rogue second row and returns the global values", async () => {
    await getAppConfig(); // seeds 'global' with defaults

    await db.insert(appConfig).values({
      id: "rogue",
      errorRetentionDays: 999,
      perfRetentionDays: 999,
      inboxRetentionDays: 999,
      deliveryRetentionDays: 999,
      updatedAt: Date.now(),
    });

    const cfg = await getAppConfig();
    expect(cfg.errorRetentionDays).toBe(30);
    expect(cfg.perfRetentionDays).toBe(7);
  });
});

describe("notification retention", () => {
  it("seeds defaults on first read without an existing config row", async () => {
    expect(await getNotificationRetention()).toEqual({
      inboxRetentionDays: 90,
      deliveryRetentionDays: 30,
    });
  });

  it("clamps each window to the documented bounds", async () => {
    expect(await setNotificationRetention({ inboxRetentionDays: 0 })).toMatchObject({
      inboxRetentionDays: 1,
    });
    expect(await setNotificationRetention({ deliveryRetentionDays: 99_999 })).toMatchObject({
      deliveryRetentionDays: 3650,
    });
  });

  // Regression guard for the WHERE clause added in #693: without it a rogue
  // second row in app_config could shadow the 'global' notification values silently.
  it("getNotificationRetention ignores a rogue second row and returns the global values", async () => {
    await getNotificationRetention(); // seeds 'global' with defaults

    await db.insert(appConfig).values({
      id: "rogue",
      errorRetentionDays: 999,
      perfRetentionDays: 999,
      inboxRetentionDays: 999,
      deliveryRetentionDays: 999,
      updatedAt: Date.now(),
    });

    const cfg = await getNotificationRetention();
    expect(cfg.inboxRetentionDays).toBe(90);
    expect(cfg.deliveryRetentionDays).toBe(30);
  });

  // The previous read-then-update implementation wrote BOTH columns from a stale
  // snapshot, so a PATCH of one window silently reset the other to whatever the
  // reader last saw. The onConflictDoUpdate set must touch only the field passed.
  it("updates only the field passed and leaves the sibling window untouched", async () => {
    await setNotificationRetention({ inboxRetentionDays: 120, deliveryRetentionDays: 45 });

    const afterInbox = await setNotificationRetention({ inboxRetentionDays: 200 });
    expect(afterInbox).toEqual({ inboxRetentionDays: 200, deliveryRetentionDays: 45 });

    const afterDelivery = await setNotificationRetention({ deliveryRetentionDays: 10 });
    expect(afterDelivery).toEqual({ inboxRetentionDays: 200, deliveryRetentionDays: 10 });

    // Errors/perf windows are owned by separate setters and must not be disturbed.
    const cfg = await db.select().from(appConfig).where(eq(appConfig.id, "global")).get();
    expect(cfg?.errorRetentionDays).toBe(30);
    expect(cfg?.perfRetentionDays).toBe(7);
  });
});

describe("sourcemap retention", () => {
  beforeEach(async () => {
    // Sweep reads app_config; seed defaults so it focuses on sourcemap prune.
    await getAppConfig();
  });

  it("does not prune when there are at most N distinct builds", async () => {
    for (let i = 0; i < RETAINED_BUILDS; i++) {
      await insertMap(`build-${i}`, i);
    }

    const result = await sweepDiagnostics();

    expect(result.sourcemaps).toBe(0);
    const remaining = await remainingBuildIds();
    expect(remaining).toHaveLength(RETAINED_BUILDS);
  });

  it("keeps the N most recently active builds and deletes older ones", async () => {
    // 55 builds: build-0 is the most recently active, build-54 the least.
    const total = RETAINED_BUILDS + 5;
    for (let i = 0; i < total; i++) {
      await insertMap(`build-${i}`, i);
    }

    const result = await sweepDiagnostics();

    // The 5 oldest builds (build-50..build-54) fall outside the window.
    expect(result.sourcemaps).toBe(5);
    const remaining = await remainingBuildIds();
    expect(remaining).toHaveLength(RETAINED_BUILDS);
    expect(remaining).toContain("build-0");
    expect(remaining).toContain("build-49");
    expect(remaining).not.toContain("build-50");
    expect(remaining).not.toContain("build-54");
  });

  it("never prunes the most-recently-active build even when its deploy is old", async () => {
    // A long-lived build deployed ages ago: most rows are old, but it keeps
    // resolving fresh stacks, so its newest map is the most recent of all.
    await insertMap("long-lived", -1); // newest activity (future-most createdAt)
    // Fill the window with newer deploys so the boundary is exercised.
    for (let i = 0; i < RETAINED_BUILDS; i++) {
      await insertMap(`build-${i}`, i + 10);
    }

    const result = await sweepDiagnostics();

    // One build (the oldest-activity of the 51) drops out, never long-lived.
    expect(result.sourcemaps).toBe(1);
    const remaining = await remainingBuildIds();
    expect(remaining).toContain("long-lived");
    expect(remaining).not.toContain(`build-${RETAINED_BUILDS - 1}`);
  });
});
