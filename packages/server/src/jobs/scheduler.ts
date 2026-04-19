import { Cron } from "croner";
import { consola } from "consola";
import { cacheCleanupJob } from "./cache-cleanup";
import { listAllPluginJobs, runPluginJob } from "./plugin-jobs";
import { sweepExpiredStore } from "../plugin-runtime/host-bridge";
import { sweepPendingAuth } from "../connections/service";

const jobs: Cron[] = [];

function registerJob(expression: string, name: string, fn: () => Promise<void>): void {
  const job = new Cron(expression, { name }, () => {
    fn().catch((err: unknown) => consola.error(`Job ${name} failed`, err));
  });
  jobs.push(job);
  consola.debug(`Registered job "${name}" with schedule "${expression}"`);
}

async function registerPluginJobs(): Promise<void> {
  const declared = await listAllPluginJobs();
  for (const job of declared) {
    registerJob(job.schedule, `plugin:${job.pluginId}:${job.id}`, () =>
      runPluginJob(job.pluginId, job.handler),
    );
  }
  consola.info(`Registered ${declared.length} plugin-declared jobs`);
}

export const scheduler = {
  async start(): Promise<void> {
    registerJob("0 * * * *", "cache-cleanup", cacheCleanupJob);
    registerJob("*/10 * * * *", "plugin-store-sweep", async () => {
      const n = await sweepExpiredStore();
      if (n > 0) consola.debug(`plugin-store-sweep removed ${n} rows`);
    });
    registerJob("*/5 * * * *", "pending-auth-sweep", async () => {
      const n = await sweepPendingAuth();
      if (n > 0) consola.debug(`pending-auth-sweep removed ${n} rows`);
    });
    await registerPluginJobs();
    consola.info(`Scheduler started with ${jobs.length} jobs`);
  },

  stop(): void {
    for (const job of jobs) job.stop();
    jobs.length = 0;
    consola.info("Scheduler stopped");
  },
};
