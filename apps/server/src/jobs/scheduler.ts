import { consola } from "consola";
import { sweepPendingAuth } from "../connections/service";
import { sweepDiagnostics } from "../diagnostics/retention";
import { cacheCleanupJob } from "./cache-cleanup";
import { registerAllPluginJobs } from "./plugin-jobs";
import { registerScheduled } from "./scheduled";
import { stopAll, list } from "./index";

/**
 * Registers every host-scheduled job owned by the infrastructure layer. Each
 * registration is a thin wrapper around the underlying sweep, following the
 * one-place convention from `docs/2026-04-20-job-service-design.md`.
 *
 * Module-owned jobs (catalog, home, notifications, plugin-runtime,
 * preferences) are NOT registered here — they live behind each module's
 * barrel-exported `registerJobs()` and are wired from
 * `apps/server/src/{index,worker}.ts` in alphabetical order. This file kept
 * to infra-only schedules so `server-infra` no longer needs to import any
 * `server-mod-*` barrel.
 *
 * Plugin-declared jobs (declared via plugin manifests, not modules) are still
 * registered after host schedules so they observe a settled host registry.
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
