import { CatalogService } from "..";
import { getDb } from "../../db/client";
import { registerCatalogMetadataRefreshJob } from "./metadata-refresh";

/**
 * Registers every host-internal catalog job. Constructed once at scheduler
 * startup; each job receives the same `CatalogService` instance so writes
 * funnel through a single facade per V37/V38.
 */
export function registerCatalogJobs(): void {
  const catalog = new CatalogService(getDb());
  registerCatalogMetadataRefreshJob({ catalog });
}

export { CATALOG_METADATA_REFRESH_JOB_ID } from "./metadata-refresh";
