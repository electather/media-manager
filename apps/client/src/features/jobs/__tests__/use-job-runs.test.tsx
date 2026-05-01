// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { act, renderHook } from "@testing-library/react";
import type { JobRunSummary } from "@ent-mcp/shared/jobs";
import { useJobRuns } from "../data/jobs.hooks";

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

async function flush(timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("useJobRuns — drawer close + reopen retains runs", () => {
  it("repopulates runs immediately after re-mounting with same jobId", async () => {
    const { result, rerender, unmount } = renderHook(
      ({ id }: { id: string | null }) => useJobRuns(id),
      { initialProps: { id: "job-x" as string | null } },
    );

    await act(async () => {
      await flush();
    });

    expect(result.current.data.length).toBe(1);
    expect(result.current.data[0]?.id).toBe("run-1");

    // Drawer "closes" — jobId becomes null.
    rerender({ id: null });
    await act(async () => {
      await flush(50);
    });
    expect(result.current.data).toEqual([]);

    // Drawer "reopens" — same jobId.
    rerender({ id: "job-x" });
    await act(async () => {
      await flush();
    });

    expect(result.current.data.length).toBe(1);
    expect(result.current.data[0]?.id).toBe("run-1");

    unmount();
  });
});
