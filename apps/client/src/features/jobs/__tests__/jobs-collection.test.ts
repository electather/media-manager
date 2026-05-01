// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { JobHandle } from "@ent-mcp/shared/jobs";
import { queryClient } from "@/shared/lib/db";
import { jobsListCollection } from "../data/jobs-list.collection";

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
  it("registers admin.jobs.list query without persist=false so IDB rehydrates", async () => {
    const seed = sampleJob({ id: "host.persist.seed", enabled: true });
    fetchMock.mockResolvedValue(jsonResponse({ jobs: [seed] }));

    subscription = jobsListCollection.subscribeChanges(() => {}) as ListSubscription;
    await waitForRow(seed.id);

    const query = queryClient.getQueryCache().find({ queryKey: ["admin", "jobs", "list"] });
    expect(query?.meta?.persist).toBeUndefined();
  });
});

describe("jobsListCollection optimistic mutation", () => {
  it("flips enabled immediately and merges server handle on success", async () => {
    const seed = sampleJob({ id: "host.opt.success", enabled: true });
    let serverEnabled = true;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/config")) {
        serverEnabled = false;
        return jsonResponse({
          job: { ...seed, enabled: serverEnabled, effectiveSchedule: "0 */6 * * *" },
        });
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
    const row = jobsListCollection.get(seed.id);
    expect(row?.enabled).toBe(false);
    // Authoritative handle from /config response merged in (computed field).
    expect(row?.effectiveSchedule).toBe("0 */6 * * *");
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
