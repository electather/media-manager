import { consola } from "consola";
import { sweepExpiredStore } from "../plugin-runtime/host-bridge";
import { sweepPendingAuth } from "../connections/service";
import { sweepExpiredErrors } from "../errors/retention";
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
      schedule: "0 * * * *",
      handler: async () => {
        await cacheCleanupJob();
      },
    });
    registerScheduled({
      id: "host.plugin_store.expired_sweep",
      schedule: "*/10 * * * *",
      handler: async () => {
        const removed = await sweepExpiredStore();
        if (removed > 0) consola.debug(`plugin-store-sweep removed ${removed} rows`);
      },
    });
    registerScheduled({
      id: "host.auth.pending_auth_sweep",
      schedule: "*/5 * * * *",
      handler: async () => {
        const removed = await sweepPendingAuth();
        if (removed > 0) consola.debug(`pending-auth-sweep removed ${removed} rows`);
      },
    });
    registerScheduled({
      id: "host.errors.retention_sweep",
      schedule: "0 3 * * *",
      handler: async () => {
        const removed = await sweepExpiredErrors();
        if (removed > 0) consola.debug(`error-retention-sweep removed ${removed} rows`);
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
