import { eq } from "drizzle-orm";
import type { HomeLayoutResponse } from "@nama/shared/home";
import { getDb, type Db } from "../../db/client";
import { homeLayoutCache } from "../../db/schema/home";

/**
 * Bump when `HomeLayoutResponse`/`HomeRowStub`/`LayoutHero` change in
 * render-affecting ways. Stale blobs fall through to cold recompose. v3:
 * `LayoutHero` reshaped to `{ slides: HeroSlide[] }` (design
 * §2026-05-05, amendment 3, rev 4); PR #227 shipped without invalidating.
 */
export const CURRENT_SCHEMA_VERSION = 3;

/** 60-minute TTL — the warm job runs hourly so any active user always
 *  reads back a sub-hour blob. */
export const LAYOUT_CACHE_TTL_MS = 60 * 60 * 1000;

export interface LayoutCacheRow {
  layout: HomeLayoutResponse;
  generatedAt: number;
}

/** A layout with no hero and no rows — the fresh-install / cold-catalog state.
 *  Treated as cold (never served from or written to the cache) so the home
 *  feed self-heals the moment discover snapshots or user activity produce
 *  content, instead of pinning the empty blob for the full TTL. */
export function isEmptyLayout(layout: HomeLayoutResponse): boolean {
  return layout.hero === null && layout.rows.length === 0;
}

/**
 * Reads cached layout for `userId`; returns null on cold miss, version
 * mismatch, or parse failure. Orchestrator falls through to live composition
 * in all cases.
 */
// Early-return cache validation (cold miss / version mismatch / parse failure);
// CRAP is coverage-estimated in CI and the paths are covered by layout-cache.test.ts.
// fallow-ignore-next-line complexity
export async function read(userId: string, db: Db = getDb()): Promise<LayoutCacheRow | null> {
  const row = await db
    .select()
    .from(homeLayoutCache)
    .where(eq(homeLayoutCache.userId, userId))
    .get();
  if (!row) return null;
  if (row.schemaVersion !== CURRENT_SCHEMA_VERSION) return null;
  try {
    const layout = JSON.parse(row.blob) as HomeLayoutResponse;
    // A cached empty layout is the cold-catalog state, not a stable result;
    // ignore it so the next read recomposes once content is available.
    if (isEmptyLayout(layout)) return null;
    return { layout, generatedAt: row.generatedAt };
  } catch {
    return null;
  }
}

/** Treats a row as fresh when its `generatedAt` is within TTL of `now`. */
export function isFresh(row: LayoutCacheRow, now: number = Date.now()): boolean {
  return now - row.generatedAt < LAYOUT_CACHE_TTL_MS;
}

/**
 * Upserts a fresh layout for `userId`. The orchestrator calls this from the
 * cold-fill path and the `host.home.layout_warm` job calls it for every
 * active user once an hour.
 */
export async function write(
  userId: string,
  layout: HomeLayoutResponse,
  db: Db = getDb(),
): Promise<void> {
  const generatedAt = layout.generatedAt;
  const blob = JSON.stringify(layout);
  await db
    .insert(homeLayoutCache)
    .values({ userId, schemaVersion: CURRENT_SCHEMA_VERSION, blob, generatedAt })
    .onConflictDoUpdate({
      target: homeLayoutCache.userId,
      set: { schemaVersion: CURRENT_SCHEMA_VERSION, blob, generatedAt },
    });
}
