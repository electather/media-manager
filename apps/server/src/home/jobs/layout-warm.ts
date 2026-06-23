import { consola } from "consola";
import { registerScheduledPerRow } from "../../jobs/scheduled-per-row";
import { buildContext, composeLayout } from "../service";
import { write as writeLayoutCache } from "../internal/layout-cache";
import { listActiveUsers, type ActiveUserRow } from "../internal/active-users";

const RUN_TIMEOUT_SEC = 30 * 60;
// Per-row cap raised from 60s to 120s (#428): a slow or offline plugin's TCP
// connect can take longer than 60s to resolve/reject, so the old cap tripped
// the per-row timeout before the compose could degrade to a partial layout.
// Exported so the regression test can pin the value.
export const PER_ROW_TIMEOUT_SEC = 120;
// Compose budget under the 120s per-row cap. 15s of slack is reserved for the
// synchronous SQLite `writeLayoutCache` upsert. Tune both numbers together if
// SQLite tail latency erodes the margin (see spec rev 6 R14).
export const WARM_COMPOSE_BUDGET_MS = 105_000;

// Circuit breaker (#428): after this many consecutive row failures the run
// stops attempting further rows. A long run of back-to-back timeouts means a
// shared plugin source is offline; continuing would burn the full per-row
// timeout on every remaining user for no benefit. The counter resets on the
// first success, so a single transient blip never trips it.
const MAX_CONSECUTIVE_FAILURES = 3;

export const HOME_LAYOUT_WARM_JOB_ID = "host.home.layout_warm";

/**
 * Per-run consecutive-failure tracker. Uses a map (rather than bare counter) so callers can track
 * independent sources; this run records every row against one key (`RUN_BREAKER_KEY`) because
 * sustained failures reflect a shared upstream source offline, not any single user.
 */
export class CircuitBreaker {
  private readonly consecutiveFailures = new Map<string, number>();

  constructor(private readonly threshold: number = MAX_CONSECUTIVE_FAILURES) {}

  /** True once `source` has failed `threshold` times in a row without a success. */
  shouldSkip(source: string): boolean {
    return (this.consecutiveFailures.get(source) ?? 0) >= this.threshold;
  }

  recordSuccess(source: string): void {
    this.consecutiveFailures.delete(source);
  }

  recordFailure(source: string): void {
    this.consecutiveFailures.set(source, (this.consecutiveFailures.get(source) ?? 0) + 1);
  }
}

/**
 * Per-row handler exported for regression tests. Enforces spec rev 6 invariant: compose runs
 * under `WARM_COMPOSE_BUDGET_MS` deadline, partials are written back, slow plugins don't surface
 * as per-row timeout.
 */
export async function runWarmComposeForUser(userId: string): Promise<void> {
  const ctx = buildContext(userId, consola, {
    deadlineMs: Date.now() + WARM_COMPOSE_BUDGET_MS,
  });
  const blob = await composeLayout(ctx, { forceFresh: true, skipWriteback: true });
  await writeLayoutCache(userId, blob);
}

/**
 * Run-level breaker key. Keyed constant (not `userId`) because `listActiveUsers` deduplicates
 * per run — keying by userId would never see two failures for the same key. Tracks consecutive
 * failures across rows as a proxy for shared upstream source offline.
 */
const RUN_BREAKER_KEY = "run";

/**
 * Drives one warm-compose row through `breaker`. Skips if breaker already tripped (stops
 * paying per-row timeout when upstream looks dead); records outcome for breaker to trip after
 * `MAX_CONSECUTIVE_FAILURES`. Re-throws so per-row runner captures error and updates aggregates.
 */
export async function runWarmRow(breaker: CircuitBreaker, userId: string): Promise<void> {
  if (breaker.shouldSkip(RUN_BREAKER_KEY)) return;
  try {
    await runWarmComposeForUser(userId);
    breaker.recordSuccess(RUN_BREAKER_KEY);
  } catch (err) {
    breaker.recordFailure(RUN_BREAKER_KEY);
    throw err;
  }
}

/**
 * Hourly per-row job: recomposes active users' home layouts into `home_layout_cache`. Per-row
 * timeout: 120s; run-wide timeout (`RUN_TIMEOUT_SEC = 30min`) matches cron interval to prevent
 * overlap. Circuit breaker short-circuits remaining rows after `MAX_CONSECUTIVE_FAILURES` failures.
 */
export function registerHomeLayoutWarm(): void {
  // One breaker per run. `rowSource` runs once at the start of each run, so we
  // reset the breaker there; the handler closes over the current instance.
  let breaker = new CircuitBreaker();
  registerScheduledPerRow<ActiveUserRow>({
    id: HOME_LAYOUT_WARM_JOB_ID,
    name: "Home layout warm",
    description: "Recomposes home layouts for users active in the last 14 days.",
    schedule: "0 * * * *",
    perRowTimeoutSec: PER_ROW_TIMEOUT_SEC,
    runTimeoutSec: RUN_TIMEOUT_SEC,
    adminTriggerable: true,
    continueOnRowError: true,
    rowSource: () => {
      breaker = new CircuitBreaker();
      return listActiveUsers();
    },
    handler: async (_ctx, row) => {
      await runWarmRow(breaker, row.userId);
    },
  });
}
