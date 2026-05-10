import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../__tests__/helpers/in-memory-db";
import { appConfig, errorRecords, perfRecords } from "../../db/schema/diagnostics";

vi.mock("../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

let db: Db;
vi.mock("../../db/client", () => ({
  getDb: () => db,
}));

const { sweepDiagnostics, setErrorRetentionDays, setPerfRetentionDays, getAppConfig } =
  await import("../retention");

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
    expect(result).toEqual({ errors: 0, perf: 0 });
  });
});
