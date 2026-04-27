import { getCatalogService } from "..";
import { registerCatalogDiscoverSnapshotJob } from "./discover-snapshot";
import { registerCatalogMetadataRefreshJob } from "./metadata-refresh";
import { registerCatalogRecommendationBuildJob } from "./recommendation-build";

/**
 * Registers every host-internal catalog job. Each job consumes the
 * process-wide `CatalogService` singleton so writes funnel through a
 * single facade per V37/V38 and per-process state (Phase 6's
 * `recordAccess` throttle) stays consistent with the preference engine.
 */
export function registerCatalogJobs(): void {
  const catalog = getCatalogService();
  registerCatalogMetadataRefreshJob({ catalog });
  registerCatalogDiscoverSnapshotJob({ catalog });
  registerCatalogRecommendationBuildJob({ catalog });
}

export { CATALOG_METADATA_REFRESH_JOB_ID } from "./metadata-refresh";
export { CATALOG_DISCOVER_SNAPSHOT_JOB_ID } from "./discover-snapshot";
export {
  CATALOG_RECOMMENDATION_BUILD_JOB_ID,
  writeRecommendationsForUser,
} from "./recommendation-build";
