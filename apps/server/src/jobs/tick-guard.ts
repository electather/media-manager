import { newRequestId } from "../diagnostics/request-context";
import { getConfig } from "./config";
import { recordSkipped } from "./history";
import { isRunning } from "./runner";

// Returns true when tick should be skipped: job disabled or instance already running.
// When running, persists skipped record. Callers: `if (await shouldSkipTick(id)) return;` at top of onTick handler.
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
