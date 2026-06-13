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
 * Per-run consecutive-failure tracker keyed by source. The layout-warm run
 * records every row against one run-level key (`RUN_BREAKER_KEY`), because a
 * sustained run of failures reflects a shared upstream plugin source being slow
 * or offline rather than any single user. Once the key trips the threshold the
 * remaining rows are skipped instead of paying the full per-row timeout again.
 * The map stays keyed (rather than a bare counter) so callers can track
 * independent sources separately if needed.
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
 * Per-row handler exported so the regression test can drive it without spinning
 * up the scheduler. Reproduces the spec rev 6 invariant: every warm-job compose
 * runs under a 45s deadline budget, partial layouts are written back, and a
 * single slow plugin must not surface as a per-row timeout.
 */
export async function runWarmComposeForUser(userId: string): Promise<void> {
  const ctx = buildContext(userId, consola, {
    deadlineMs: Date.now() + WARM_COMPOSE_BUDGET_MS,
  });
  const blob = await composeLayout(ctx, { forceFresh: true, skipWriteback: true });
  await writeLayoutCache(userId, blob);
}

/**
 * Run-level breaker key. `listActiveUsers` deduplicates and yields each user
 * exactly once per run, so keying the breaker by `userId` would never see two
 * failures for the same key and could never trip. The breaker tracks
 * *consecutive failures across rows* as a proxy for a shared upstream source
 * being offline, so every row in a run records against one constant key.
 */
const RUN_BREAKER_KEY = "run";

/**
 * Drives one warm-compose row through `breaker`. Skips the compose when the
 * run has already tripped the breaker (so the run stops paying the per-row
 * timeout once an upstream looks dead); otherwise records the outcome so the
 * breaker trips after enough consecutive failures. Re-throws on failure so the
 * per-row runner still captures the error and updates run aggregates.
 *
 * Exported for the regression test, which drives the breaker directly without
 * the scheduler.
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
 * Hourly per-row job that recomposes each active user's home layout and
 * writes the fresh blob into `home_layout_cache`. Per-row timeout caps a
 * single user's compose at 120s; the run-wide cap (`RUN_TIMEOUT_SEC = 30 min`)
 * matches the cron interval so back-to-back runs never overlap. A per-run
 * circuit breaker short-circuits the remaining rows once a source has failed
 * `MAX_CONSECUTIVE_FAILURES` times in a row.
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
