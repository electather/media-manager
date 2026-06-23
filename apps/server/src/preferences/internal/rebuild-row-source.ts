import * as repo from "../repo";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const INCREMENTAL_REBUILD_THRESHOLD = 20;
// `host.catalog.recommendation_build` runs at 02:00 and rebuilds the same
// per-user partitions before writing its rec list. The daily safety-net
// sweep at 03:00 should skip any user whose profile is already fresher
// than this threshold so we don't redo the work unnecessarily.
const DAILY_FRESH_PROFILE_WINDOW_MS = 6 * 60 * 60 * 1000;

export interface RebuildRow {
  userId: string;
}

/**
 * Drives the daily rebuild row source. Unions three conditions: first-run
 * users (any activity, no profile), stale-profile users, and users whose
 * incremental buffer has accumulated enough signal to warrant a full rebuild.
 */
export async function listUsersNeedingRebuild(now: number = Date.now()): Promise<RebuildRow[]> {
  const [firstRun, stale, bursty] = await Promise.all([
    repo.listFirstRunUsers(),
    repo.listStaleProfileUsers(now - SEVEN_DAYS_MS),
    repo.listBurstyFeedbackUsers(INCREMENTAL_REBUILD_THRESHOLD),
  ]);
  const ids = new Set<string>();
  for (const row of [...firstRun, ...stale, ...bursty]) {
    ids.add(row.userId);
  }
  return [...ids].map((userId) => ({ userId }));
}

/**
 * Filters daily_rebuild row source: drops users whose combined profile was
 * rebuilt within DAILY_FRESH_PROFILE_WINDOW_MS (already covered by 02:00 catalog
 * rec-build). Keeps users without profile + older rebuilds for safety-net sweep.
 */
export async function listUsersNeedingDailyRebuild(
  now: number = Date.now(),
): Promise<RebuildRow[]> {
  const candidates = await listUsersNeedingRebuild(now);
  if (candidates.length === 0) return candidates;
  const fresh = await repo.listFreshCombinedUserIds(now - DAILY_FRESH_PROFILE_WINDOW_MS);
  const skip = new Set(fresh);
  return candidates.filter((row) => !skip.has(row.userId));
}
