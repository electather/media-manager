import { consola } from "consola";
import { getCatalogService } from "../../catalog";
import { MediaService } from "../../media";
import { registerScheduledPerRow } from "../../jobs/scheduled-per-row";
import { listSeededUserIds } from "../repo";
import { hydrateLibrary } from "../service";

export const LIBRARY_HYDRATE_JOB_ID = "library.hydrate";

const RUN_TIMEOUT_SEC = 30 * 60;
const PER_ROW_TIMEOUT_SEC = 60;

// Availability moves faster than membership (a copy is added or re-encoded
// between the 6-hourly syncs), so the dedicated hydrate pass uses a 1-hour
// staleness window — every row older than an hour is re-projected.
const HYDRATE_STALE_TTL_MS = 60 * 60 * 1000;

/** Hourly per-row job re-hydrating stale availability (design §Sync + hydrate: "hourly").
 * Distinct from 6-hourly `library.sync`; availability changes faster than membership.
 * `checkAvailability` fan-out is design's N-call cost — acceptable here, never on read path. */
export function registerHydrateLibraryJob(): void {
  registerScheduledPerRow<{ userId: string }>({
    id: LIBRARY_HYDRATE_JOB_ID,
    name: "Library availability hydrate",
    description: "Re-hydrates stale library availability and quality for each seeded user.",
    schedule: "0 * * * *",
    perRowTimeoutSec: PER_ROW_TIMEOUT_SEC,
    runTimeoutSec: RUN_TIMEOUT_SEC,
    adminTriggerable: true,
    continueOnRowError: true,
    rowSource: () => listSeededUserIds(),
    handler: async (_ctx, row) => {
      const mediaService = new MediaService(row.userId);
      await hydrateLibrary(
        {
          userId: row.userId,
          mediaService,
          catalog: getCatalogService(),
          log: consola,
        },
        { staleTtlMs: HYDRATE_STALE_TTL_MS },
      );
    },
  });
}
