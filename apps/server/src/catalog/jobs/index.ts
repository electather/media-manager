import { getCatalogService } from "../service";
import { registerCatalogDiscoverSnapshotJob } from "./discover-snapshot";
import { registerCatalogMetadataRefreshJob } from "./metadata-refresh";
import { registerCatalogPruneJob } from "./prune";
import { registerCatalogRecommendationBuildJob } from "./recommendation-build";
import { registerCatalogUserMirrorSyncJob } from "./user-mirror-sync";

/**
 * Registers every host-internal catalog job. Each job consumes the
 * process-wide `CatalogService` singleton so writes funnel through a
 * single facade per V37/V38 and per-process state (the `recordAccess`
 * throttle landed in Phase 6) stays consistent with the preference engine.
 */
export function registerCatalogJobs(): void {
  const catalog = getCatalogService();
  registerCatalogMetadataRefreshJob({ catalog });
  registerCatalogDiscoverSnapshotJob({ catalog });
  registerCatalogRecommendationBuildJob({ catalog });
  registerCatalogUserMirrorSyncJob({ catalog });
  registerCatalogPruneJob({ catalog });
}

export { CATALOG_METADATA_REFRESH_JOB_ID } from "./metadata-refresh";
export { CATALOG_DISCOVER_SNAPSHOT_JOB_ID } from "./discover-snapshot";
export {
  CATALOG_RECOMMENDATION_BUILD_JOB_ID,
  writeRecommendationsForUser,
} from "./recommendation-build";
export { CATALOG_USER_MIRROR_SYNC_JOB_ID } from "./user-mirror-sync";
export { CATALOG_PRUNE_JOB_ID } from "./prune";
