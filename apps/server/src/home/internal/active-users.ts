import { getCatalogService } from "../../catalog";
import { getPreferencesService } from "../../preferences";

const ACTIVE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export interface ActiveUserRow {
  userId: string;
}

/**
 * Users active in last 14 days: feedback event OR history-mirror sync. Union
 * includes watchers who never rate. Reads through service barrels (preferences
 * feedback, catalog sync) — no cross-module drizzle.
 */
export async function listActiveUsers(now: number = Date.now()): Promise<ActiveUserRow[]> {
  const cutoff = now - ACTIVE_WINDOW_MS;
  // The two reads hit independent owner modules with no data dependency, so
  // run them concurrently to halve the warm-job latency per tick.
  const [fb, hist] = await Promise.all([
    getPreferencesService().listUserIdsWithFeedbackSince(cutoff),
    getCatalogService().listUserIdsSyncedSince(cutoff),
  ]);
  return [...new Set([...fb, ...hist])].map((userId) => ({ userId }));
}
