import { consola } from "consola";
import { sweepExpiredStore } from "../plugin-runtime/host-bridge";
import { sweepPendingAuth } from "../connections/service";
import { sweepExpiredErrors } from "../errors/retention";
import { registerCatalogJobs } from "../catalog/jobs";
import { registerPreferenceJobs } from "../preferences/jobs";
import { registerHomeLayoutWarmJob } from "../home/jobs/layout-warm";
import { cacheCleanupJob } from "./cache-cleanup";
import { registerAllPluginJobs } from "./plugin-jobs";
import { registerScheduled } from "./scheduled";
import { stopAll, list } from "./index";

/**
 * Registers every host-internal scheduled job. Each registration is a thin
 * wrapper around the underlying sweep; credits to the design doc for the
 * one-place convention. Plugin-declared jobs are registered afterward.
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
      id: "host.plugin_store.expired_sweep",
      name: "Plugin store cleanup",
      description: "Sweeps expired rows from the plugin key-value store.",
      schedule: "*/10 * * * *",
      adminTriggerable: true,
      handler: async () => {
        const removed = await sweepExpiredStore();
        if (removed > 0) consola.debug(`plugin-store-sweep removed ${removed} rows`);
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
      id: "host.errors.retention_sweep",
      name: "Error record retention",
      description: "Deletes error records older than the configured retention window.",
      schedule: "0 3 * * *",
      adminTriggerable: true,
      handler: async () => {
        const removed = await sweepExpiredErrors();
        if (removed > 0) consola.debug(`error-retention-sweep removed ${removed} rows`);
      },
    });

    registerPreferenceJobs();
    registerCatalogJobs();
    registerHomeLayoutWarmJob();

    const pluginCount = await registerAllPluginJobs();
    const total = (await list()).length;
    consola.info(`Scheduler started with ${total} jobs (${pluginCount} from plugins)`);
  },

  stop(): void {
    stopAll();
    consola.info("Scheduler stopped");
  },
};
