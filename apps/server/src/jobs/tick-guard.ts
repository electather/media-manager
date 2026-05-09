import { newRequestId } from "../diagnostics/request-context";
import { getConfig } from "./config";
import { recordSkipped } from "./history";
import { isRunning } from "./runner";

/**
 * Returns true when the tick should be skipped: either the job is disabled or
 * an instance is already running (in which case a skipped record is persisted).
 * Callers do `if (await shouldSkipTick(id)) return;` at the top of their
 * onTick handler.
 */
export async function shouldSkipTick(jobId: string): Promise<boolean> {
  const cfg = await getConfig(jobId);
  if (!cfg.enabled) return true;
  if (isRunning(jobId)) {
    await recordSkipped({
      id: crypto.randomUUID(),
      jobId,
      triggeredBy: "cron",
      requestId: newRequestId(),
      tickAt: Date.now(),
    });
    return true;
  }
  return false;
}
