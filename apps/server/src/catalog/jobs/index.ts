import { getCatalogService } from "../service";
import { registerCatalogDiscoverSnapshotJob } from "./discover-snapshot";
import { registerCatalogMetadataRefreshJob } from "./metadata-refresh";
import { registerCatalogPruneJob } from "./prune";
import { registerCatalogRecommendationBuildJob } from "./recommendation-build";
import { registerCatalogUserMirrorSyncJob } from "./user-mirror-sync";

/**
 * Registers all host-internal catalog jobs. Each consumes the process-wide `CatalogService`
 * singleton so writes funnel through a single facade (V37/V38) and per-process state
 * (Phase 6's `recordAccess` throttle) stays consistent with the preference engine.
 */
export function registerCatalogJobs(): void {
  const catalog = getCatalogService();
  registerCatalogMetadataRefreshJob({ catalog });
  registerCatalogDiscoverSnapshotJob({ catalog });
  registerCatalogRecommendationBuildJob({ catalog });
  registerCatalogUserMirrorSyncJob({ catalog });
  registerCatalogPruneJob({ catalog });
}

export { CATALOG_DISCOVER_SNAPSHOT_JOB_ID, runCatalogDiscoverSnapshot } from "./discover-snapshot";
export { writeRecommendationsForUser } from "./recommendation-build";
