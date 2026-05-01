// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { JobHandle } from "@ent-mcp/shared/jobs";
import { queryClient } from "@/shared/lib/db";
import { jobsListCollection } from "../data/jobs-list.collection";
import { jobDetailCollection } from "../data/job-detail.collection";

interface ListSubscription {
  unsubscribe: () => void;
}

const sampleJob = (overrides: Partial<JobHandle> = {}): JobHandle => ({
  id: "host.test.alpha",
  name: "Alpha",
  kind: "scheduled",
  enabled: true,
  adminTriggerable: false,
  userTriggerable: false,
  ...overrides,
});

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

async function waitForRow(id: string, timeoutMs = 1_500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = jobsListCollection.get(id);
    if (row) return row;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timeout waiting for row ${id}`);
}

let fetchMock: ReturnType<typeof vi.fn>;
let subscription: ListSubscription | null = null;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  subscription?.unsubscribe();
  subscription = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // Force the next test to refetch against its own stub.
  await queryClient.invalidateQueries({ queryKey: ["admin", "jobs", "list"] });
});

describe("jobsListCollection persistence boundary", () => {
  it("registers admin.jobs.list query with meta.persist=false", async () => {
    const seed = sampleJob({ id: "host.persist.seed", enabled: true });
    fetchMock.mockResolvedValue(jsonResponse({ jobs: [seed] }));

    subscription = jobsListCollection.subscribeChanges(() => {}) as ListSubscription;
    await waitForRow(seed.id);

    const query = queryClient.getQueryCache().find({ queryKey: ["admin", "jobs", "list"] });
    expect(query?.meta?.persist).toBe(false);
  });
});

describe("jobsListCollection optimistic mutation", () => {
  it("flips enabled immediately and resolves when onUpdate succeeds", async () => {
    const seed = sampleJob({ id: "host.opt.success", enabled: true });
    let serverEnabled = true;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/config")) {
        serverEnabled = false;
        return jsonResponse({ job: { ...seed, enabled: serverEnabled } });
      }
      return jsonResponse({ jobs: [{ ...seed, enabled: serverEnabled }] });
    });

    subscription = jobsListCollection.subscribeChanges(() => {}) as ListSubscription;
    await waitForRow(seed.id);
    expect(jobsListCollection.get(seed.id)?.enabled).toBe(true);

    const tx = jobsListCollection.update(seed.id, (draft) => {
      draft.enabled = false;
    });
    expect(jobsListCollection.get(seed.id)?.enabled).toBe(false);

    await tx.isPersisted.promise;
    expect(jobsListCollection.get(seed.id)?.enabled).toBe(false);
  });

  it("rolls back when onUpdate rejects", async () => {
    const seed = sampleJob({ id: "host.opt.rollback", enabled: true });
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/config")) return jsonResponse({ error: "boom" }, { status: 500 });
      return jsonResponse({ jobs: [seed] });
    });

    subscription = jobsListCollection.subscribeChanges(() => {}) as ListSubscription;
    await waitForRow(seed.id);
    expect(jobsListCollection.get(seed.id)?.enabled).toBe(true);

    const tx = jobsListCollection.update(seed.id, (draft) => {
      draft.enabled = false;
    });
    expect(jobsListCollection.get(seed.id)?.enabled).toBe(false);

    await expect(tx.isPersisted.promise).rejects.toThrow();
    expect(jobsListCollection.get(seed.id)?.enabled).toBe(true);
  });
});

describe("jobDetailCollection structural sharing", () => {
  it("seeds detail cache from list when row already known", async () => {
    const seed = sampleJob({ id: "host.detail.seed", enabled: true, name: "Seeded" });
    fetchMock.mockResolvedValue(jsonResponse({ jobs: [seed] }));
    subscription = jobsListCollection.subscribeChanges(() => {}) as ListSubscription;
    await waitForRow(seed.id);

    // Stub /admin/jobs/:id so the detail collection can fire its background
    // refetch without breaking; assertion runs before that resolves.
    fetchMock.mockImplementation(async () => jsonResponse({ job: seed }));

    const detailKey = ["admin", "jobs", "detail.job", seed.id];
    expect(queryClient.getQueryData(detailKey)).toBeUndefined();

    const detail = jobDetailCollection(seed.id);

    expect(queryClient.getQueryData(detailKey)).toEqual([seed]);
    void detail.cleanup();
  });

  it("skips seeding when the row is not in the list", () => {
    const detailKey = ["admin", "jobs", "detail.job", "host.unknown"];
    expect(queryClient.getQueryData(detailKey)).toBeUndefined();
    const detail = jobDetailCollection("host.unknown");
    expect(queryClient.getQueryData(detailKey)).toBeUndefined();
    void detail.cleanup();
  });
});
