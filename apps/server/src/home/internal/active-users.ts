import { sql } from "drizzle-orm";
import { getDb } from "../../db/client";
// TASK-046: home warm job reads feedback via preferences barrel (deferred).
// fallow-ignore-next-line boundary-violation
import { feedback } from "../../db/schema/preferences/feedback";
// TASK-046: home warm job reads userHistoryMirror via catalog barrel (deferred).
// fallow-ignore-next-line boundary-violation
import { userHistoryMirror } from "../../db/schema/catalog";

const ACTIVE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export interface ActiveUserRow {
  userId: string;
}

/**
 * Returns every user with activity in the last 14 days. "Activity" = either
 * a feedback event (likes / ratings) or a fresh history-mirror sync. The
 * union keeps users who watch but never rate eligible for warm fills.
 *
 * Reads `feedback` (owned by preferences) and `userHistoryMirror` (owned by
 * catalog) directly — both imports carry `fallow-ignore-next-line
 * boundary-violation` directives under TASK-046 with the same reason: the
 * warm job is the sole cross-module query path here, and routing through
 * service barrels would require adding cross-module list-user-id surfaces
 * on `preferences` and `catalog` purely for this job. The barrel additions
 * are deferred to a follow-up so this PR stays scoped to the layout
 * retrofit and the parallel Phase 3d catalog refactor can shape its own
 * surface without merge churn.
 */
export async function listActiveUsers(now: number = Date.now()): Promise<ActiveUserRow[]> {
  const db = getDb();
  const cutoff = now - ACTIVE_WINDOW_MS;
  // The two reads hit independent tables with no data dependency, so run them
  // concurrently to halve the warm-job latency per tick.
  const [recentFeedback, recentHistory] = await Promise.all([
    db
      .selectDistinct({ userId: feedback.userId })
      .from(feedback)
      .where(sql`${feedback.createdAt} >= ${cutoff}`)
      .all(),
    db
      .selectDistinct({ userId: userHistoryMirror.userId })
      .from(userHistoryMirror)
      .where(sql`${userHistoryMirror.lastSyncedAt} >= ${cutoff}`)
      .all(),
  ]);
  const ids = new Set<string>();
  for (const row of recentFeedback) ids.add(row.userId);
  for (const row of recentHistory) ids.add(row.userId);
  return [...ids].map((userId) => ({ userId }));
}
