import { anyRunning } from "../../jobs";
import { registerScheduled } from "../../jobs/scheduled";
import type { JobRunContext } from "../../jobs/types";
import { PREFERENCE_MANUAL_REBUILD_JOB_ID } from "../../preferences/jobs";
import type { CatalogService } from "../../catalog";
import { CATALOG_RECOMMENDATION_BUILD_JOB_ID } from "./recommendation-build";

const DAY_MS = 24 * 60 * 60 * 1000;
const UNUSED_AFTER_DAYS = 90;
const SNAPSHOT_RETENTION_DAYS = 7;

export const CATALOG_PRUNE_JOB_ID = "host.catalog.prune";

export interface CatalogPruneDeps {
  catalog: CatalogService;
}

/**
 * Registers the daily prune sweep. Runs at 07:00 — well after the 02:00
 * rec-build window and the 04:00 metadata refresh — and short-circuits
 * if any rec-build job is currently running so the prune cannot race
 * an in-flight rec-list write that would otherwise pin items it
 * intends to drop.
 */
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
  if (anyRunning([CATALOG_RECOMMENDATION_BUILD_JOB_ID, PREFERENCE_MANUAL_REBUILD_JOB_ID])) {
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
