import { getCatalogService } from "..";
import { registerCatalogMetadataRefreshJob } from "./metadata-refresh";

/**
 * Registers every host-internal catalog job. Each job consumes the
 * process-wide `CatalogService` singleton so writes funnel through a
 * single facade per V37/V38 and per-process state (Phase 6's
 * `recordAccess` throttle) stays consistent with the preference engine.
 */
export function registerCatalogJobs(): void {
  registerCatalogMetadataRefreshJob({ catalog: getCatalogService() });
}

export { CATALOG_METADATA_REFRESH_JOB_ID } from "./metadata-refresh";
