import { anyRunning } from "../../jobs";
import { registerScheduled } from "../../jobs/scheduled";
import type { JobRunContext } from "../../jobs/types";
import { getPreferencesService } from "../../preferences";
import type { CatalogService } from "../../catalog";
import { CATALOG_RECOMMENDATION_BUILD_JOB_ID } from "./recommendation-build";

const DAY_MS = 24 * 60 * 60 * 1000;
const UNUSED_AFTER_DAYS = 90;
const SNAPSHOT_RETENTION_DAYS = 7;

export const CATALOG_PRUNE_JOB_ID = "host.catalog.prune";

export interface CatalogPruneDeps {
  catalog: CatalogService;
}

// Daily prune at 07:00 (after 02:00 rec-build and 04:00 metadata refresh).
// Short-circuits if rec-build running to avoid racing rec-list writes that pin items to delete.
export function registerCatalogPruneJob(deps: CatalogPruneDeps): void {
  registerScheduled({
    id: CATALOG_PRUNE_JOB_ID,
    name: "Catalog prune",
    description:
      "Drops cold canonical_metadata rows and discover_snapshots older than the retention window.",
    schedule: "0 7 * * *",
    timeoutSec: 30 * 60,
    adminTriggerable: true,
    handler: (ctx) => runCatalogPrune(deps, ctx),
  });
}

export async function runCatalogPrune(deps: CatalogPruneDeps, ctx: JobRunContext): Promise<void> {
  if (
    anyRunning([CATALOG_RECOMMENDATION_BUILD_JOB_ID]) ||
    getPreferencesService().isManualRebuildRunning()
  ) {
    ctx.logger.info(
      "[catalog:prune] skipped — recommendation build is currently running; eviction would race rec-list writes",
    );
    return;
  }
  ctx.abortSignal.throwIfAborted();
  const metadata = await deps.catalog.pruneUnusedMetadata(
    UNUSED_AFTER_DAYS * DAY_MS,
    undefined,
    SNAPSHOT_RETENTION_DAYS,
  );
  ctx.abortSignal.throwIfAborted();
  const snapshots = await deps.catalog.pruneOldDiscoverSnapshots(SNAPSHOT_RETENTION_DAYS);
  ctx.logger.info(
    `[catalog:prune] dropped ${metadata.deleted} metadata rows + ${snapshots.deleted} stale snapshots`,
  );
}
