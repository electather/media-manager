import { MediaService } from "../../media";
import type { CatalogService } from "../../catalog";
import { registerScheduledPerRow } from "../../jobs/scheduled-per-row";
import type { JobRunContext } from "../../jobs/types";
import { collectHistoryEvents, collectRatingEvents } from "../internal/mirror-event-collection";
import { listSyncRows, type SyncRow } from "../internal/mirror-sync-rows";

const PER_ROW_TIMEOUT_SEC = 60;
const RUN_TIMEOUT_SEC = 30 * 60;

export const CATALOG_USER_MIRROR_SYNC_JOB_ID = "host.catalog.user_mirror_sync";

export interface CatalogUserMirrorSyncDeps {
  catalog: CatalogService;
}

// Registers every-six-hours catalog mirror sync (one row per userId, pluginId pair).
// watchHistory@v1 and ratings@v1 sync in separate try blocks so transient failure on one
// capability doesn't stall the other; cursor advancement per-table per V39.
export function registerCatalogUserMirrorSyncJob(deps: CatalogUserMirrorSyncDeps): void {
  registerScheduledPerRow<SyncRow>({
    id: CATALOG_USER_MIRROR_SYNC_JOB_ID,
    name: "Catalog user mirror sync",
    description:
      "Syncs watch history and ratings from connected plugins into the catalog mirror tables.",
    schedule: "0 */6 * * *",
    perRowTimeoutSec: PER_ROW_TIMEOUT_SEC,
    runTimeoutSec: RUN_TIMEOUT_SEC,
    adminTriggerable: true,
    continueOnRowError: true,
    rowSource: () => listSyncRows(),
    handler: (ctx, row) => syncUserPluginPair(deps, ctx, row),
  });
}

async function syncMirrorEvents<E>(
  ctx: JobRunContext,
  label: string,
  row: SyncRow,
  collect: () => Promise<E[]>,
  getTimestamp: (event: E) => number,
  append: (events: E[], cursorTs: number) => Promise<void>,
): Promise<void> {
  ctx.abortSignal.throwIfAborted();
  try {
    const events = await collect();
    if (events.length > 0) {
      const cursorTs = events.reduce((max, ev) => Math.max(max, getTimestamp(ev)), 0);
      await append(events, cursorTs);
    }
  } catch (err) {
    if (isAbortError(err, ctx)) throw err;
    ctx.logger.warn(
      `[catalog:user-mirror-sync] ${label} dispatch failed for ${row.userId}/${row.pluginId}: ${formatError(err)}`,
    );
  }
}

export async function syncUserPluginPair(
  deps: CatalogUserMirrorSyncDeps,
  ctx: JobRunContext,
  row: SyncRow,
): Promise<void> {
  const media = new MediaService(row.userId);

  // Cancellation must propagate; any other failure on one capability logs a
  // warning and lets the other block still run so a transient error on one
  // plugin does not block the sibling sync.
  await syncMirrorEvents(
    ctx,
    "history",
    row,
    () => collectHistoryEvents(media, row.pluginId),
    (ev) => ev.watchedAt,
    (events, cursorTs) =>
      deps.catalog.appendUserHistory(row.userId, events, row.pluginId, cursorTs),
  );
  await syncMirrorEvents(
    ctx,
    "ratings",
    row,
    () => collectRatingEvents(media, row.pluginId),
    (ev) => ev.ratedAt,
    (events, cursorTs) =>
      deps.catalog.appendUserRatings(row.userId, events, row.pluginId, cursorTs),
  );
}

function isAbortError(err: unknown, ctx: JobRunContext): boolean {
  if (ctx.abortSignal.aborted) return true;
  if (err instanceof Error && err.name === "AbortError") return true;
  return false;
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
