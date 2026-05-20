import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { and, eq } from "drizzle-orm";
import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../__tests__/helpers/in-memory-db";
import { jobRuns } from "../../db/schema/infra/jobs";
import type { JobRunStatus } from "@ent-mcp/shared/jobs";

let db: Db;
vi.mock("../../db/client", () => ({
  getDb: () => db,
}));

const { pruneSuccessfulRuns } = await import("../history");

const JOB_ID = "job.test.retention";

afterAll(() => cleanupInMemoryDbs());

beforeEach(async () => {
  db = await createInMemoryDb();
});

async function insertRun(args: {
  id: string;
  status: JobRunStatus;
  startedAt: number;
  jobId?: string;
}): Promise<void> {
  await db.insert(jobRuns).values({
    id: args.id,
    jobId: args.jobId ?? JOB_ID,
    scopeKey: null,
    status: args.status,
    triggeredBy: "cron",
    triggeredByUserId: null,
    startedAt: args.startedAt,
    finishedAt: args.startedAt,
    durationMs: 0,
    requestId: `req-${args.id}`,
    rowsTotal: null,
    rowsSucceeded: null,
    rowsFailed: null,
    errorRecordId: null,
    result: null,
    coalescedCount: null,
  });
}

async function seedSucceeded(count: number, startTs: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await insertRun({ id: `s-${i}`, status: "succeeded", startedAt: startTs + i });
  }
}

describe("pruneSuccessfulRuns", () => {
  it("deletes nothing when at or below the retention cap", async () => {
    await seedSucceeded(50, 1_000);

    const deleted = await pruneSuccessfulRuns(JOB_ID);

    expect(deleted).toBe(0);
    const rows = await db
      .select({ id: jobRuns.id })
      .from(jobRuns)
      .where(eq(jobRuns.jobId, JOB_ID))
      .all();
    expect(rows).toHaveLength(50);
  });

  it("deletes oldest excess and keeps the newest 50 when over the cap", async () => {
    // 60 succeeded rows ordered by startedAt: s-0 oldest, s-59 newest.
    await seedSucceeded(60, 1_000);

    const deleted = await pruneSuccessfulRuns(JOB_ID);

    expect(deleted).toBe(10);
    const kept = await db
      .select({ id: jobRuns.id })
      .from(jobRuns)
      .where(and(eq(jobRuns.jobId, JOB_ID), eq(jobRuns.status, "succeeded")))
      .all();
    const keptIds = kept.map((r) => r.id).sort();
    const expected = Array.from({ length: 50 }, (_, i) => `s-${i + 10}`).sort();
    expect(keptIds).toEqual(expected);
  });

  it("leaves non-succeeded rows untouched regardless of count", async () => {
    // Design-doc fixture: 60 succeeded + 3 failed → keeps 50 succeeded + all 3 failed.
    await seedSucceeded(60, 1_000);
    await insertRun({ id: "f-0", status: "failed", startedAt: 500 });
    await insertRun({ id: "f-1", status: "failed", startedAt: 600 });
    await insertRun({ id: "f-2", status: "failed", startedAt: 700 });
    await insertRun({ id: "k-0", status: "skipped", startedAt: 800 });

    const deleted = await pruneSuccessfulRuns(JOB_ID);

    expect(deleted).toBe(10);
    const survivors = await db
      .select({ id: jobRuns.id, status: jobRuns.status })
      .from(jobRuns)
      .where(eq(jobRuns.jobId, JOB_ID))
      .all();
    const failed = survivors
      .filter((r) => r.status === "failed")
      .map((r) => r.id)
      .sort();
    const skipped = survivors.filter((r) => r.status === "skipped").map((r) => r.id);
    const succeeded = survivors.filter((r) => r.status === "succeeded");
    expect(failed).toEqual(["f-0", "f-1", "f-2"]);
    expect(skipped).toEqual(["k-0"]);
    expect(succeeded).toHaveLength(50);
  });

  it("scopes deletes to the given jobId", async () => {
    await seedSucceeded(60, 1_000);
    // Another job with 60 succeeded rows must be untouched.
    for (let i = 0; i < 60; i += 1) {
      await insertRun({
        id: `other-${i}`,
        status: "succeeded",
        startedAt: 2_000 + i,
        jobId: "job.other",
      });
    }

    const deleted = await pruneSuccessfulRuns(JOB_ID);

    expect(deleted).toBe(10);
    const otherRows = await db
      .select({ id: jobRuns.id })
      .from(jobRuns)
      .where(eq(jobRuns.jobId, "job.other"))
      .all();
    expect(otherRows).toHaveLength(60);
  });

  it("returns 0 when jobId is empty", async () => {
    expect(await pruneSuccessfulRuns("")).toBe(0);
  });
});
