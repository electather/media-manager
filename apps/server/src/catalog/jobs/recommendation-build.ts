import type { ProfileMediaType } from "@nama/shared/preferences";
import { getPreferencesService, type RebuildRow } from "../../preferences";
import { registerScheduledPerRow } from "../../jobs/scheduled-per-row";
import type { JobRunContext } from "../../jobs/types";
import {
  writeRecommendationsForUser,
  type CatalogRecommendationBuildDeps,
} from "../internal/recommendation-writer";

const PER_ROW_TIMEOUT_SEC = 120;
const RUN_TIMEOUT_SEC = 90 * 60;
const PARTITIONS: ProfileMediaType[] = ["movie", "tv", "combined"];

export const CATALOG_RECOMMENDATION_BUILD_JOB_ID = "host.catalog.recommendation_build";

// Re-exported so existing consumers (preferences manual rebuild, tests) keep
// their import path while the implementation lives in catalog/internal/.
export { writeRecommendationsForUser, type CatalogRecommendationBuildDeps };

/**
 * Nightly per-user recommendation builder (02:00). Runs before metadata-refresh (04:00)
 * and discover-snapshot (06:00) so downstream jobs see coherent profile/version.
 */
export function registerCatalogRecommendationBuildJob(deps: CatalogRecommendationBuildDeps): void {
  registerScheduledPerRow<RebuildRow>({
    id: CATALOG_RECOMMENDATION_BUILD_JOB_ID,
    name: "Catalog recommendation build",
    description: "Rebuilds preference profiles and persists per-user recommendation lists.",
    schedule: "0 2 * * *",
    perRowTimeoutSec: PER_ROW_TIMEOUT_SEC,
    runTimeoutSec: RUN_TIMEOUT_SEC,
    adminTriggerable: true,
    continueOnRowError: true,
    rowSource: () => getPreferencesService().listUsersNeedingRebuild(),
    handler: (ctx, row) => buildRecommendationsForUser(deps, ctx, row.userId),
  });
}

/**
 * Per-row body for the nightly job: rebuild the three profile partitions
 * and persist a fresh rec list.
 */
async function buildRecommendationsForUser(
  deps: CatalogRecommendationBuildDeps,
  ctx: JobRunContext,
  userId: string,
): Promise<void> {
  const service = getPreferencesService();
  for (const partition of PARTITIONS) {
    ctx.abortSignal.throwIfAborted();
    await service.rebuildProfile(userId, partition, ctx.abortSignal);
  }
  await writeRecommendationsForUser(
    deps,
    userId,
    ctx.abortSignal,
    ctx.logger.info.bind(ctx.logger),
  );
}
