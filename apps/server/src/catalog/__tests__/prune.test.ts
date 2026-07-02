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

import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../__tests__/helpers/in-memory-db";
import { CatalogService } from "../service";
import { toCanonicalRow } from "../canonical";
import { pruneUnusedMetadataRows } from "../service/prune";
import { canonicalMetadata } from "../../db/schema/catalog";
import { and, eq } from "drizzle-orm";
import type { MetadataKey, RecItem } from "@nama/shared/catalog";
import { seedUser } from "./helpers";

afterAll(() => cleanupInMemoryDbs());

const DAY_MS = 24 * 60 * 60 * 1000;

describe("CatalogService.pruneUnusedMetadata", () => {
  let catalog: CatalogService;
  let db: Db;

  beforeEach(async () => {
    db = await createInMemoryDb();
    catalog = new CatalogService(db);
  });

  it("drops cold rows that no rec list or recent snapshot references", async () => {
    const now = Date.now();
    const cold = toCanonicalRow(
      { tmdbId: "1", type: "movie" },
      { title: "Cold", type: "movie", ids: { tmdb_id: "1" } },
      now - 200 * DAY_MS,
    );
    // Skip the "row exists" pre-check — `getMetadata` calls `recordAccess`
    // and bumps `last_accessed_at` past the cutoff, defeating the prune.
    await catalog.writeMetadata([cold]);

    const result = await catalog.pruneUnusedMetadata(90 * DAY_MS);

    expect(result.deleted).toBe(1);
    expect(await new CatalogService(db).getMetadata("1", "movie")).toBeNull();
  });

  it("retains cold rows referenced by an active recommendation list", async () => {
    const now = Date.now();
    await seedUser(db, "u1");
    const cold = toCanonicalRow(
      { tmdbId: "1", type: "movie" },
      { title: "Pinned", type: "movie", ids: { tmdb_id: "1" } },
      now - 200 * DAY_MS,
    );
    await catalog.writeMetadata([cold]);
    const items: RecItem[] = [
      { tmdbId: "1", mediaType: "movie", matchReason: null, topContributors: [], score: 0.9 },
    ];
    await catalog.writeRecommendationList("u1", "default", items, 1);

    const result = await catalog.pruneUnusedMetadata(90 * DAY_MS);

    expect(result.deleted).toBe(0);
    expect(await new CatalogService(db).getMetadata("1", "movie")).not.toBeNull();
  });

  it("retains cold rows referenced by a discover snapshot from the last 7 days", async () => {
    const now = Date.now();
    const today = Math.floor(now / DAY_MS) * DAY_MS;
    const cold = toCanonicalRow(
      { tmdbId: "1", type: "movie" },
      { title: "Trending", type: "movie", ids: { tmdb_id: "1" } },
      now - 200 * DAY_MS,
    );
    await catalog.writeMetadata([cold]);
    const refs: MetadataKey[] = [{ tmdbId: "1", type: "movie" }];
    await catalog.writeDiscoverSnapshot("trending", "popularity_desc", today, refs);

    const result = await catalog.pruneUnusedMetadata(90 * DAY_MS);

    expect(result.deleted).toBe(0);
    expect(await new CatalogService(db).getMetadata("1", "movie")).not.toBeNull();
  });

  it("respects an explicit refSet argument over the default ref derivation", async () => {
    const now = Date.now();
    const cold = toCanonicalRow(
      { tmdbId: "1", type: "movie" },
      { title: "Forced-pin", type: "movie", ids: { tmdb_id: "1" } },
      now - 200 * DAY_MS,
    );
    await catalog.writeMetadata([cold]);

    const result = await catalog.pruneUnusedMetadata(90 * DAY_MS, new Set(["movie:1"]));

    expect(result.deleted).toBe(0);
  });

  it("does not evict a row whose lastAccessedAt is bumped past cutoff mid-sweep (#906)", async () => {
    const now = Date.now();
    const cutoffMs = 90 * DAY_MS;
    const cold = toCanonicalRow(
      { tmdbId: "1", type: "movie" },
      { title: "Racing", type: "movie", ids: { tmdb_id: "1" } },
      now - 200 * DAY_MS,
    );
    await catalog.writeMetadata([cold]);

    // Simulate the TOCTOU window: after the prune SELECT resolves the cold
    // candidate, a concurrent access bumps lastAccessedAt to now. The DELETE
    // must re-check lastAccessedAt and spare the freshly-hit row (#906).
    let bumped = false;
    const bumpOnce = async () => {
      if (bumped) return;
      bumped = true;
      await db
        .update(canonicalMetadata)
        .set({ lastAccessedAt: now })
        .where(and(eq(canonicalMetadata.tmdbId, "1"), eq(canonicalMetadata.mediaType, "movie")));
    };
    // Wrap the select builder so resolving the candidate scan (the select that
    // returns the cold row tmdbId "1") triggers the concurrent bump before the
    // DELETE. Keyed on the resolved rows, not select order, so an extra select
    // added before the scan can't misfire the bump (#906).
    const returnedColdCandidate = (rows: unknown): boolean =>
      Array.isArray(rows) && rows.some((r) => (r as { tmdbId?: string }).tmdbId === "1");
    const wrapThenable = (q: PromiseLike<unknown>): PromiseLike<unknown> =>
      new Proxy(q as object, {
        get(t, prop, recv) {
          if (prop === "then") {
            return (onOk: (v: unknown) => unknown, onErr: (e: unknown) => unknown) =>
              (t as PromiseLike<unknown>)
                .then(async (rows) => {
                  if (returnedColdCandidate(rows)) await bumpOnce();
                  return rows;
                })
                .then(onOk, onErr);
          }
          const v = Reflect.get(t, prop, recv);
          if (typeof v === "function") {
            return (...args: unknown[]) => {
              const out = (v as (...a: unknown[]) => unknown).apply(t, args);
              return out && typeof out === "object"
                ? wrapThenable(out as PromiseLike<unknown>)
                : out;
            };
          }
          return v;
        },
      }) as PromiseLike<unknown>;
    const racingDb = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "select") {
          return (...args: unknown[]) =>
            wrapThenable(
              (target.select as unknown as (...a: unknown[]) => PromiseLike<unknown>)(...args),
            );
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as Db;

    const result = await pruneUnusedMetadataRows(racingDb, cutoffMs, new Set(), 7);

    expect(bumped).toBe(true);
    expect(result.deleted).toBe(0);
    expect(await new CatalogService(db).getMetadata("1", "movie")).not.toBeNull();
  });
});
