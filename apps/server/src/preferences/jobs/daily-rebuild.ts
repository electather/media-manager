import { registerScheduledPerRow } from "../../jobs/scheduled-per-row";
import { listUsersNeedingDailyRebuild, type RebuildRow } from "../internal/rebuild-row-source";
import { getPreferencesService } from "../service";
import { PREFERENCE_DAILY_JOB_ID } from "./ids";

export { PREFERENCE_DAILY_JOB_ID } from "./ids";

/**
 * Daily safety net: rebuilds profile partitions for users with stale/missing profiles.
 * Runs 03:00, offset after `host.catalog.recommendation_build` (02:00) to avoid `profile_version` race.
 * Catches users skipped by catalog job (e.g., row-source mid-flight failure) once rec window settles.
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
