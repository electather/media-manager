import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../env", () => ({
  env: {
    CACHE_PROVIDER: "memory",
    ENCRYPTION_KEY: "test-key",
    SQLITE_PATH: "file::memory:",
    BETTER_AUTH_SECRET: "x".repeat(32),
    BETTER_AUTH_URL: "http://localhost",
    APP_EXTERNAL_URL: "http://localhost",
  },
}));

// Shared spy that all MediaService instances will delegate to. Replaced in
// each beforeEach so test isolation is preserved.
let getMetadataMock = vi.fn();

vi.mock("../../media", () => ({
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  MediaService: class {
    getMetadata(...args: unknown[]) {
      return getMetadataMock(...args);
    }
  },
}));

import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../__tests__/helpers/in-memory-db";
import { CatalogService } from "../service";
import { runCatalogMetadataRefresh } from "../jobs/metadata-refresh";
import type { MetadataKey } from "@nama/shared/catalog";
import type { JobRunContext } from "../../jobs/types";

afterAll(() => cleanupInMemoryDbs());

function makeCtx(): JobRunContext {
  const controller = new AbortController();
  return {
    abortSignal: controller.signal,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      success: vi.fn(),
    },
  } as unknown as JobRunContext;
}

function staleKey(tmdbId: string): MetadataKey {
  return { tmdbId, type: "movie" };
}

describe("runCatalogMetadataRefresh", () => {
  let db: Db;
  let catalog: CatalogService;

  beforeEach(async () => {
    db = await createInMemoryDb();
    catalog = new CatalogService(db);
    getMetadataMock = vi.fn();
  });

  it("logs refreshed, not-found, and failed counts as distinct values", async () => {
    // Write three stale rows so the refresh job has keys to process.
    const now = Date.now();
    const staleTs = now - 60 * 24 * 60 * 60 * 1000;
    const baseRow = {
      title: "T",
      type: "movie" as const,
      keywords: [],
      cast: [],
      director: null,
      writers: [],
      creators: [],
      genres: [],
      ids: { tmdb_id: "1" },
    };

    const { toCanonicalRow } = await import("../canonical");
    await catalog.writeMetadata([
      { ...toCanonicalRow(staleKey("1"), baseRow, staleTs), lastRefreshedAt: staleTs },
      {
        ...toCanonicalRow(staleKey("2"), { ...baseRow, ids: { tmdb_id: "2" } }, staleTs),
        lastRefreshedAt: staleTs,
      },
      {
        ...toCanonicalRow(staleKey("3"), { ...baseRow, ids: { tmdb_id: "3" } }, staleTs),
        lastRefreshedAt: staleTs,
      },
    ]);

    // Key "1" refreshes successfully, key "2" returns null (not-found),
    // key "3" rejects (genuine failure).
    getMetadataMock
      .mockResolvedValueOnce({ ...baseRow, title: "Refreshed", ids: { tmdb_id: "1" } })
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("upstream timeout"));

    const ctx = makeCtx();
    await runCatalogMetadataRefresh({ catalog }, ctx);

    // The summary log must distinguish all three outcomes so operators can
    // see real plugin error rates without null results inflating failures.
    expect(ctx.logger.info).toHaveBeenCalledWith(
      expect.stringMatching(/1 refreshed.*1 not-found.*1 failed/),
    );
  });

  it("does not count a not-found result as a failure", async () => {
    const now = Date.now();
    const staleTs = now - 60 * 24 * 60 * 60 * 1000;
    const baseRow = {
      title: "T",
      type: "movie" as const,
      keywords: [],
      cast: [],
      director: null,
      writers: [],
      creators: [],
      genres: [],
      ids: { tmdb_id: "4" },
    };

    const { toCanonicalRow } = await import("../canonical");
    await catalog.writeMetadata([
      { ...toCanonicalRow(staleKey("4"), baseRow, staleTs), lastRefreshedAt: staleTs },
    ]);

    // A fulfilled fetch that returns null is not-found, not a failure.
    getMetadataMock.mockResolvedValueOnce(null);

    const ctx = makeCtx();
    await runCatalogMetadataRefresh({ catalog }, ctx);

    expect(ctx.logger.info).toHaveBeenCalledWith(
      expect.stringMatching(/0 refreshed.*1 not-found.*0 failed/),
    );
  });
});
