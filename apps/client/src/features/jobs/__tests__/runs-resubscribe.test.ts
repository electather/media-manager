// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { JobRunSummary } from "@ent-mcp/shared/jobs";
import { jobRunsRegistry } from "../data/job-runs.collection";

const sampleRun = (overrides: Partial<JobRunSummary> = {}): JobRunSummary => ({
  id: "run-1",
  jobId: "job-x",
  scopeKey: null,
  status: "succeeded",
  triggeredBy: "admin",
  triggeredByUserId: null,
  startedAt: 1,
  finishedAt: 2,
  durationMs: 1,
  requestId: "r",
  rowsTotal: null,
  rowsSucceeded: null,
  rowsFailed: null,
  errorRecordId: null,
  result: null,
  logs: null,
  logsTruncated: 0,
  coalescedCount: null,
  ...overrides,
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => jsonResponse({ runs: [sampleRun({ id: "run-1" })] })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function waitForRow(
  collection: { get: (id: string) => unknown },
  id: string,
  timeoutMs = 1500,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (collection.get(id)) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timeout waiting for row ${id}`);
}

describe("jobRunsRegistry — re-subscribe after unsub keeps rows", () => {
  it("retains rows on second acquire (drawer close + reopen)", async () => {
    const c = jobRunsRegistry.acquire("job-x");
    const sub1 = c.subscribeChanges(() => {});
    await waitForRow(c, "run-1");
    expect(c.size).toBe(1);

    sub1.unsubscribe();
    jobRunsRegistry.release("job-x");

    // Reopen quickly — same instance.
    const c2 = jobRunsRegistry.acquire("job-x");
    expect(c2).toBe(c);
    expect(c2.size).toBe(1);
    expect(c2.get("run-1")?.id).toBe("run-1");

    const sub2 = c2.subscribeChanges(() => {});
    expect(c2.size).toBe(1);
    sub2.unsubscribe();
    jobRunsRegistry.release("job-x");
  });
});
