import { Cron } from "croner";
import { consola } from "consola";
import { cacheCleanupJob } from "./cache-cleanup";
import { listAllPluginJobs, runPluginJob } from "./plugin-jobs";
import { sweepExpiredStore } from "../plugin-runtime/host-bridge";
import { sweepPendingAuth } from "../connections/service";
import { sweepExpiredErrors } from "../errors/retention";
import { captureError } from "../errors/capture";
import { runWithRequestContext, newRequestId } from "../errors/request-context";

const jobs: Cron[] = [];

function registerJob(expression: string, name: string, fn: () => Promise<void>): void {
  const job = new Cron(expression, { name }, async () => {
    // Each job tick gets its own request context so any errors captured downstream
    // chain back to this specific run. Unhandled throws are recorded as "cron" errors.
    await runWithRequestContext(
      { requestId: newRequestId(), userId: null, route: `cron:${name}` },
      async () => {
        try {
          await fn();
        } catch (err) {
          consola.error(`Job ${name} failed`, err);
          await captureError(err, {
            severity: "error",
            source: "cron",
            code: "cron.job_failed",
            route: `cron:${name}`,
            context: { jobName: name },
          });
        }
      },
    );
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
    registerJob("0 3 * * *", "error-retention-sweep", async () => {
      const n = await sweepExpiredErrors();
      if (n > 0) consola.debug(`error-retention-sweep removed ${n} rows`);
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
