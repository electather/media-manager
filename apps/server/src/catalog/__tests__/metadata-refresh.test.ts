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
// each beforeEach so test isolation is preserved. The job consumes the full
// `AggregateResult` so it can tell an upstream removal apart from an outage.
let getMetadataResultMock = vi.fn();

vi.mock("../../media", () => ({
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  MediaService: class {
    getMetadataResult(...args: unknown[]) {
      return getMetadataResultMock(...args);
    }
  },
}));

const dispatchError = {
  pluginId: "tmdb",
  connectionId: null,
  code: "plugin.unavailable" as const,
  devMessage: "upstream 503",
};

/** Shapes a successful dispatch result around the raw canonical source. */
function ok(data: unknown) {
  return { data, errors: [], attempted: 1 };
}

/** A fulfilled dispatch with no data and no errors — a genuine removal. */
const notFoundResult = { data: null, errors: [], attempted: 1 };

/** A fulfilled dispatch where every contacted provider errored. */
const allFailedResult = { data: null, errors: [dispatchError], attempted: 1 };

/** A dispatch where no provider was contacted at all (none configured). */
const noProviderResult = { data: null, errors: [], attempted: 0 };

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
    getMetadataResultMock = vi.fn();
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
    getMetadataResultMock
      .mockResolvedValueOnce(ok({ ...baseRow, title: "Refreshed", ids: { tmdb_id: "1" } }))
      .mockResolvedValueOnce(notFoundResult)
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
    getMetadataResultMock.mockResolvedValueOnce(notFoundResult);

    const ctx = makeCtx();
    await runCatalogMetadataRefresh({ catalog }, ctx);

    expect(ctx.logger.info).toHaveBeenCalledWith(
      expect.stringMatching(/0 refreshed.*1 not-found.*0 failed/),
    );
  });

  it("counts an all-providers-errored dispatch as a failure, not not-found", async () => {
    // When every provider errors (e.g. TMDB is down or rate-limited) the
    // dispatch resolves with `data: null` but a non-empty `errors` array. This
    // is a transient outage, not an upstream removal — it must increment the
    // failure counter so a real outage is never silently logged as not-found.
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
      ids: { tmdb_id: "5" },
    };

    const { toCanonicalRow } = await import("../canonical");
    await catalog.writeMetadata([
      { ...toCanonicalRow(staleKey("5"), baseRow, staleTs), lastRefreshedAt: staleTs },
    ]);

    getMetadataResultMock.mockResolvedValueOnce(allFailedResult);

    const ctx = makeCtx();
    await runCatalogMetadataRefresh({ catalog }, ctx);

    expect(ctx.logger.info).toHaveBeenCalledWith(
      expect.stringMatching(/0 refreshed.*0 not-found.*1 failed/),
    );
  });

  it("counts a no-provider-contacted dispatch as a failure, not not-found", async () => {
    // When the metadata capability has no configured provider the dispatch
    // resolves with `attempted: 0` and no errors. Nothing was actually queried,
    // so the title was never confirmed absent — bucketing it as not-found would
    // wrongly report it as an upstream removal. It must count as a failure.
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
      ids: { tmdb_id: "6" },
    };

    const { toCanonicalRow } = await import("../canonical");
    await catalog.writeMetadata([
      { ...toCanonicalRow(staleKey("6"), baseRow, staleTs), lastRefreshedAt: staleTs },
    ]);

    getMetadataResultMock.mockResolvedValueOnce(noProviderResult);

    const ctx = makeCtx();
    await runCatalogMetadataRefresh({ catalog }, ctx);

    expect(ctx.logger.info).toHaveBeenCalledWith(
      expect.stringMatching(/0 refreshed.*0 not-found.*1 failed/),
    );
  });
});
