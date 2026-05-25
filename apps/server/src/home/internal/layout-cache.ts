import { eq } from "drizzle-orm";
import type { HomeLayoutResponse } from "@ent-mcp/shared/home";
import { getDb, type Db } from "../../db/client";
import { homeLayoutCache } from "../../db/schema/home";

/**
 * Bump every time `HomeLayoutResponse`, `HomeRowStub`, or `LayoutHero` change
 * in a way the orchestrator's compose pass would render differently. Stale
 * blobs whose `schema_version` disagrees with this constant fall through to
 * the cold path and get rewritten — pre-stable means we replace, not migrate.
 *
 * v3: Amendment 3 (rev 4) of `docs/2026-05-05-home-page-backend-design.md`
 * reshaped `LayoutHero` from `{ item, source, reason, resumeUrl, alternates }`
 * to `{ slides: HeroSlide[] }`. The earlier `library availability` PR had
 * already moved the constant 1 → 2 with the previous hero shape baked into
 * the blob, so PR #227 still shipped without invalidating those rows; bump
 * to 3 so every cached old-shape blob falls through to a cold compose.
 */
export const CURRENT_SCHEMA_VERSION = 3;

/** 60-minute TTL — the warm job runs hourly so any active user always
 *  reads back a sub-hour blob. */
export const LAYOUT_CACHE_TTL_MS = 60 * 60 * 1000;

export interface LayoutCacheRow {
  layout: HomeLayoutResponse;
  generatedAt: number;
}

/**
 * Reads the cached layout for `userId`. Returns null on cold miss, on a
 * `schema_version` mismatch (treated as cold), or if the stored blob fails
 * to parse — the orchestrator falls through to live composition + writeback
 * in every case, so signalling absence is enough.
 */
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
