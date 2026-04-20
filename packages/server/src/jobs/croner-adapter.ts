import { Cron } from "croner";

/**
 * Only file allowed to import croner. An ESLint rule (or a reviewer) prevents
 * other modules from pulling Cron in directly. Keeping this thin so the job
 * service can swap out the scheduler backend without a broad refactor.
 */

const scheduled = new Map<string, Cron>();

/** Registers a cron entry keyed by jobId. Replaces any prior entry for the same id. */
export function scheduleCron(jobId: string, expression: string, onTick: () => void): void {
  unscheduleCron(jobId);
  const name = `job:${jobId}`;
  scheduled.set(jobId, new Cron(expression, { name }, onTick));
}

/** Removes the cron entry for `jobId` if one exists. */
export function unscheduleCron(jobId: string): void {
  const prior = scheduled.get(jobId);
  if (prior) {
    prior.stop();
    scheduled.delete(jobId);
  }
}

/** Returns the next fire time for a registered cron, or null if unscheduled. */
export function nextFireTime(jobId: string): Date | null {
  return scheduled.get(jobId)?.nextRun() ?? null;
}

/** Stops every scheduled entry. Intended for shutdown. */
export function unscheduleAll(): void {
  for (const cron of scheduled.values()) cron.stop();
  scheduled.clear();
}

/** Throws if the expression is not a valid cron expression (croner's parser). */
export function assertValidSchedule(expression: string): void {
  try {
    new Cron(expression, { paused: true });
  } catch (err) {
    throw new Error(`invalid cron expression: ${err instanceof Error ? err.message : String(err)}`);
  }
}
