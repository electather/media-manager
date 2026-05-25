import { consola } from "consola";
import { getCatalogService } from "../../catalog";
import { MediaService } from "../../media";
import { registerScheduledPerRow } from "../../jobs/scheduled-per-row";
import * as repo from "../internal/repo";
import { syncFromPlugins } from "../service";

export const WATCHLIST_SYNC_JOB_ID = "watchlist.sync_plugin";

const RUN_TIMEOUT_SEC = 30 * 60;
const PER_ROW_TIMEOUT_SEC = 30;

interface SeededUserRow {
  userId: string;
}

/**
 * Registers the 6-hourly per-row job that refreshes plugin-sourced watchlist
 * items for every previously-seeded user. Row failures do not block the run
 * — the run-status aggregate captures partials so admins can inspect them.
 */
export function registerSyncPluginWatchlist(): void {
  registerScheduledPerRow<SeededUserRow>({
    id: WATCHLIST_SYNC_JOB_ID,
    name: "Watchlist plugin sync",
    description: "Pulls new watchlist items from plugins for each seeded user.",
    schedule: "0 */6 * * *",
    perRowTimeoutSec: PER_ROW_TIMEOUT_SEC,
    runTimeoutSec: RUN_TIMEOUT_SEC,
    adminTriggerable: true,
    continueOnRowError: true,
    rowSource: () => repo.listSeededUserIds(),
    handler: async (_ctx, row) => {
      const mediaService = new MediaService(row.userId);
      const catalog = getCatalogService();
      await syncFromPlugins({
        userId: row.userId,
        mediaService,
        catalog,
        log: consola,
      });
    },
  });
}
