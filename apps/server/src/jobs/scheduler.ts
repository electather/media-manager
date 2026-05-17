import { consola } from "consola";
// fallow-allow: phase-2 infra-to-module decoupling
// fallow-ignore-next-line boundary-violation
import { sweepExpiredStore } from "../plugin-runtime";
import { sweepPendingAuth } from "../connections/service";
import { sweepDiagnostics } from "../diagnostics/retention";
// fallow-allow: phase-2 infra-to-module decoupling
// fallow-ignore-next-line boundary-violation
import { registerCatalogJobs } from "../catalog";
// fallow-allow: phase-2 infra-to-module decoupling
// fallow-ignore-next-line boundary-violation
import { registerPreferenceJobs } from "../preferences";
// fallow-allow: phase-2 infra-to-module decoupling
// fallow-ignore-next-line boundary-violation
import { registerHomeLayoutWarmJob } from "../home";
// prettier-ignore
// fallow-allow: phase-2 infra-to-module decoupling
// fallow-ignore-next-line boundary-violation
import { registerDeliveryJob, registerStalePendingSweep, registerDemoNotificationJob } from "../notifications";
import { cacheCleanupJob } from "./cache-cleanup";
import { registerAllPluginJobs } from "./plugin-jobs";
import { registerScheduled } from "./scheduled";
import { stopAll, list } from "./index";

/**
 * Registers every host-internal scheduled job. Each registration is a thin
 * wrapper around the underlying sweep, following the one-place convention
 * described in `docs/2026-04-20-job-service-design.md`. Plugin-declared
 * jobs are registered afterward.
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
      id: "host.diagnostics.retention_sweep",
      name: "Diagnostics retention",
      description: "Deletes error and perf records older than their respective retention windows.",
      schedule: "0 3 * * *",
      adminTriggerable: true,
      handler: async () => {
        const { errors, perf } = await sweepDiagnostics();
        if (errors > 0 || perf > 0) {
          consola.debug(`diagnostics-retention-sweep removed ${errors} errors / ${perf} perf rows`);
        }
      },
    });

    registerPreferenceJobs();
    registerCatalogJobs();
    registerHomeLayoutWarmJob();
    registerDeliveryJob();
    registerStalePendingSweep();
    registerDemoNotificationJob();

    const pluginCount = await registerAllPluginJobs();
    const total = (await list()).length;
    consola.info(`Scheduler started with ${total} jobs (${pluginCount} from plugins)`);
  },

  stop(): void {
    stopAll();
    consola.info("Scheduler stopped");
  },
};
