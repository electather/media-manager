import { consola } from "consola";
import { sweepPendingAuth } from "../connections/service";
import { sweepDiagnostics } from "../diagnostics/retention";
import { cacheCleanupJob } from "./cache-cleanup";
import { registerAllPluginJobs } from "./plugin-jobs";
import { registerScheduled } from "./scheduled";
import { stopAll, list } from "./index";

/**
 * Registers host-scheduled jobs owned by the infrastructure layer (see `docs/2026-04-20-job-service-design.md`).
 * Module-owned jobs (catalog, home, etc.) are NOT here—they live in each module's barrel-exported `registerJobs()`.
 * Plugin-declared jobs are registered after host schedules to observe a settled host registry.
 */
export const scheduler = {
  async start(): Promise<void> {
    registerScheduled({
      id: "host.cache.cleanup",
      name: "Cache cleanup",
      description: "Removes expired entries from the active cache provider.",
      schedule: "0 0 * * *",
      adminTriggerable: true,
      handler: async (ctx) => {
        await cacheCleanupJob(ctx);
      },
    });
    registerScheduled({
      id: "host.auth.pending_auth_sweep",
      name: "Pending auth cleanup",
      description: "Removes expired pending authentication requests.",
      schedule: "*/5 * * * *",
      adminTriggerable: true,
      handler: async () => {
        const removed = await sweepPendingAuth();
        if (removed > 0) consola.debug(`pending-auth-sweep removed ${removed} rows`);
      },
    });
    registerScheduled({
      id: "host.diagnostics.retention_sweep",
      name: "Diagnostics retention",
      description:
        "Deletes error and perf records older than their retention windows and prunes sourcemaps for superseded builds.",
      schedule: "0 3 * * *",
      adminTriggerable: true,
      handler: async () => {
        const { errors, perf, sourcemaps } = await sweepDiagnostics();
        if (errors > 0 || perf > 0 || sourcemaps > 0) {
          consola.debug(
            `diagnostics-retention-sweep removed ${errors} errors / ${perf} perf rows / ${sourcemaps} sourcemaps`,
          );
        }
      },
    });

    const pluginCount = await registerAllPluginJobs();
    const total = (await list()).length;
    consola.info(`Scheduler started with ${total} jobs (${pluginCount} from plugins)`);
  },

  stop(): void {
    stopAll();
    consola.info("Scheduler stopped");
  },
};
