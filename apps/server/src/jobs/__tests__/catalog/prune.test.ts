import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { consola } from "consola";

vi.mock("../../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

const anyRunningMock = vi.fn();
vi.mock("../../../jobs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../jobs")>();
  return {
    ...actual,
    anyRunning: (...args: unknown[]) => anyRunningMock(...args),
  };
});

const { cleanupInMemoryDbs, createInMemoryDb } =
  await import("../../../__tests__/helpers/in-memory-db");
const { CatalogService } = await import("../../../catalog/service");
const { runCatalogPrune } = await import("../../../catalog/jobs/prune");
import type { JobRunContext } from "../../types";

afterAll(() => cleanupInMemoryDbs());

beforeEach(() => {
  anyRunningMock.mockReset();
});

function buildJobCtx(overrides: Partial<JobRunContext> = {}): JobRunContext {
  return {
    runId: "run-1",
    triggeredBy: "cron",
    requestId: "req-1",
    logger: consola,
    abortSignal: new AbortController().signal,
    ...overrides,
  };
}

describe("host.catalog.prune handler", () => {
  it("skips the sweep when a recommendation build is currently running", async () => {
    const catalog = new CatalogService(await createInMemoryDb());
    const pruneMetadata = vi.spyOn(catalog, "pruneUnusedMetadata");
    const pruneSnapshots = vi.spyOn(catalog, "pruneOldDiscoverSnapshots");
    anyRunningMock.mockReturnValue(true);

    await runCatalogPrune({ catalog }, buildJobCtx());

    expect(pruneMetadata).not.toHaveBeenCalled();
    expect(pruneSnapshots).not.toHaveBeenCalled();
  });

  it("delegates to both prune methods when no rec build is in flight", async () => {
    const catalog = new CatalogService(await createInMemoryDb());
    const pruneMetadata = vi
      .spyOn(catalog, "pruneUnusedMetadata")
      .mockResolvedValue({ deleted: 3 });
    const pruneSnapshots = vi
      .spyOn(catalog, "pruneOldDiscoverSnapshots")
      .mockResolvedValue({ deleted: 2 });
    anyRunningMock.mockReturnValue(false);

    await runCatalogPrune({ catalog }, buildJobCtx());

    expect(pruneMetadata).toHaveBeenCalledOnce();
    expect(pruneSnapshots).toHaveBeenCalledOnce();
  });

  it("propagates a pre-aborted signal instead of running the prune", async () => {
    const catalog = new CatalogService(await createInMemoryDb());
    const pruneMetadata = vi.spyOn(catalog, "pruneUnusedMetadata");
    anyRunningMock.mockReturnValue(false);
    const aborter = new AbortController();
    aborter.abort(new Error("cancelled"));

    await expect(
      runCatalogPrune({ catalog }, buildJobCtx({ abortSignal: aborter.signal })),
    ).rejects.toThrow();

    expect(pruneMetadata).not.toHaveBeenCalled();
  });
});
