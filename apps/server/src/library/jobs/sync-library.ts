import { consola } from "consola";
import { getCatalogService } from "../../catalog";
import { MediaService } from "../../media";
import { registerScheduledPerRow } from "../../jobs/scheduled-per-row";
import { listSeededUserIds } from "../repo";
import { hydrateLibrary, syncLibrary } from "../service";

export const LIBRARY_SYNC_JOB_ID = "library.sync";

const RUN_TIMEOUT_SEC = 30 * 60;
const PER_ROW_TIMEOUT_SEC = 30;

interface SeededUserRow {
  userId: string;
}

/**
 * Registers the 6-hourly per-row job that re-syncs owned-library membership
 * for every previously-seeded user (design §Sync + hydrate). Iterates exactly
 * the seeded users so a fresh install fans out to nobody. After reconciling
 * membership it hydrates the user's new and stale rows so freshly inserted
 * titles get their browse projection without waiting for the hourly hydrate
 * pass. Row failures do not block the run — the run-status aggregate captures
 * partials so admins can inspect them. Mirrors
 * `watchlist/jobs/sync-plugin-watchlist.ts`.
 */
export function registerSyncLibraryJob(): void {
  registerScheduledPerRow<SeededUserRow>({
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
      await syncLibrary(ctx);
      // Hydrate new and long-stale rows right after membership reconciles so a
      // freshly owned title gets its browse projection on this same run. The
      // hourly `library.hydrate` job handles the faster availability staleness.
      await hydrateLibrary(ctx);
    },
  });
}
