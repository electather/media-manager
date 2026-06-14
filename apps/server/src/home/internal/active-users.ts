import { getCatalogService } from "../../catalog";
import { getPreferencesService } from "../../preferences";

const ACTIVE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export interface ActiveUserRow {
  userId: string;
}

/**
 * Returns every user with activity in the last 14 days. "Activity" = either
 * a feedback event (likes / ratings) or a fresh history-mirror sync. The
 * union keeps users who watch but never rate eligible for warm fills.
 *
 * The two signals come from tables owned by other modules, so this reads
 * them through the owner barrels: feedback ids via the preferences service
 * and history-sync ids via the catalog service. No raw cross-module drizzle.
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
