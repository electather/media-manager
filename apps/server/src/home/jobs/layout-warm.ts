import { sql } from "drizzle-orm";
import { consola } from "consola";
import { getDb } from "../../db/client";
import { feedback } from "../../db/schema/feedback";
import { userHistoryMirror } from "../../db/schema/catalog";
import { registerScheduledPerRow } from "../../jobs/scheduled-per-row";
import { buildContext, composeLayout } from "../service";
import { write as writeLayoutCache } from "../repo";

const ACTIVE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const RUN_TIMEOUT_SEC = 30 * 60;
const PER_ROW_TIMEOUT_SEC = 60;

export const HOME_LAYOUT_WARM_JOB_ID = "host.home.layout_warm";

interface ActiveUserRow {
  userId: string;
}

/**
 * Returns every user with activity in the last 14 days. "Activity" = either
 * a feedback event (likes / ratings) or a fresh history-mirror sync. The
 * union keeps users who watch but never rate eligible for warm fills.
 *
 * Reads `feedback` (owned by preferences) and `userHistoryMirror` (owned by
 * catalog) directly — both imports are listed in
 * `tools/check-table-ownership.ts` under TASK-046 with the same reason: the
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
  const recentFeedback = await db
    .selectDistinct({ userId: feedback.userId })
    .from(feedback)
    .where(sql`${feedback.createdAt} >= ${cutoff}`)
    .all();
  const recentHistory = await db
    .selectDistinct({ userId: userHistoryMirror.userId })
    .from(userHistoryMirror)
    .where(sql`${userHistoryMirror.lastSyncedAt} >= ${cutoff}`)
    .all();
  const ids = new Set<string>();
  for (const row of [...recentFeedback, ...recentHistory]) ids.add(row.userId);
  return [...ids].map((userId) => ({ userId }));
}

/**
 * Hourly per-row job that recomposes each active user's home layout and
 * writes the fresh blob into `home_layout_cache`. Per-row timeout caps a
 * single user's compose at 60s; the run-wide cap (`RUN_TIMEOUT_SEC = 30 min`)
 * matches the cron interval so back-to-back runs never overlap.
 */
export function registerHomeLayoutWarm(): void {
  registerScheduledPerRow<ActiveUserRow>({
    id: HOME_LAYOUT_WARM_JOB_ID,
    name: "Home layout warm",
    description: "Recomposes home layouts for users active in the last 14 days.",
    schedule: "0 * * * *",
    perRowTimeoutSec: PER_ROW_TIMEOUT_SEC,
    runTimeoutSec: RUN_TIMEOUT_SEC,
    adminTriggerable: true,
    continueOnRowError: true,
    rowSource: () => listActiveUsers(),
    handler: async (_ctx, row) => {
      const ctx = buildContext(row.userId, consola);
      const blob = await composeLayout(ctx, { forceFresh: true, skipWriteback: true });
      await writeLayoutCache(row.userId, blob);
    },
  });
}
