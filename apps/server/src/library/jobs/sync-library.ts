import { consola } from "consola";
import { getCatalogService } from "../../catalog";
import { MediaService } from "../../media";
import { registerScheduledPerRow } from "../../jobs/scheduled-per-row";
import { listSeededUserIds } from "../repo";
import { hydrateLibrary, syncMembership } from "../service";

export const LIBRARY_SYNC_JOB_ID = "library.sync";

const RUN_TIMEOUT_SEC = 30 * 60;
const PER_ROW_TIMEOUT_SEC = 30;

/** 6-hourly job re-syncing owned-library membership for seeded users (design §Sync + hydrate).
 * After reconciling membership, hydrates new/stale rows so freshly inserted titles get browse projection on same run.
 * Row failures don't block; run-status aggregate captures partials for admin inspection. Mirrors watchlist/jobs/sync-plugin-watchlist.ts. */
export function registerSyncLibraryJob(): void {
  registerScheduledPerRow<{ userId: string }>({
    id: LIBRARY_SYNC_JOB_ID,
    name: "Library membership sync",
    description: "Re-syncs owned-library membership from the collection feed for each seeded user.",
    schedule: "0 */6 * * *",
    perRowTimeoutSec: PER_ROW_TIMEOUT_SEC,
    runTimeoutSec: RUN_TIMEOUT_SEC,
    adminTriggerable: true,
    continueOnRowError: true,
    rowSource: () => listSeededUserIds(),
    handler: async (_ctx, row) => {
      const mediaService = new MediaService(row.userId);
      const ctx = {
        userId: row.userId,
        mediaService,
        catalog: getCatalogService(),
        log: consola,
      };
      await syncMembership(ctx);
      // Hydrate new and long-stale rows right after membership reconciles so a
      // freshly owned title gets its browse projection on this same run. The
      // hourly `library.hydrate` job handles the faster availability staleness.
      await hydrateLibrary(ctx);
    },
  });
}
