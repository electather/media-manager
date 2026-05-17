import { consola } from "consola";
import { registerScheduled } from "../../jobs/scheduled";
import { sweepExpiredStore } from "../host-bridge";

/**
 * Registers the scheduled cleanup that prunes expired rows from the plugin
 * key-value store. Wired from `plugin-runtime.registerJobs()` so the scheduler
 * no longer reaches into plugin-runtime internals.
 */
export function registerStoreSweepJob(): void {
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
}
