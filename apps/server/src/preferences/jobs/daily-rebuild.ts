import { registerScheduledPerRow } from "../../jobs/scheduled-per-row";
import { listUsersNeedingDailyRebuild, type RebuildRow } from "../internal/rebuild-row-source";
import { getPreferencesService } from "../service";
import { PREFERENCE_DAILY_JOB_ID } from "./ids";

export { PREFERENCE_DAILY_JOB_ID } from "./ids";

/**
 * Daily safety-net rebuild. Walks the `listUsersNeedingDailyRebuild` row
 * source and rebuilds the three profile partitions for any user whose
 * profile is stale or missing. Runs at 03:00 — offset behind
 * `host.catalog.recommendation_build` (02:00) so the two jobs do not race
 * `profile_version` on the same user set. The catalog rec build already
 * rebuilds profiles before writing its list; this sweep stays as the safety
 * net for users the catalog job did not touch (e.g. row-source mid-flight
 * failure) and runs once the rec window has settled.
 */
export function registerDailyRebuild(): void {
  registerScheduledPerRow<RebuildRow>({
    id: PREFERENCE_DAILY_JOB_ID,
    name: "Daily preference rebuild",
    description: "Rebuilds preference profiles for users with stale or missing profiles.",
    schedule: "0 3 * * *",
    adminTriggerable: true,
    rowSource: () => listUsersNeedingDailyRebuild(),
    handler: async (ctx, row) => {
      const service = getPreferencesService();
      await service.rebuildProfile(row.userId, "movie", ctx.abortSignal);
      await service.rebuildProfile(row.userId, "tv", ctx.abortSignal);
      await service.rebuildProfile(row.userId, "combined", ctx.abortSignal);
    },
    perRowTimeoutSec: 120,
    runTimeoutSec: 60 * 60,
    continueOnRowError: true,
  });
}
