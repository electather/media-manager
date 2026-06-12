import { sql } from "drizzle-orm";
import { consola } from "consola";
import { getDb } from "../../db/client";
// TASK-046: home warm job reads feedback via preferences barrel (deferred).
// fallow-ignore-next-line boundary-violation
import { feedback } from "../../db/schema/preferences/feedback";
// TASK-046: home warm job reads userHistoryMirror via catalog barrel (deferred).
// fallow-ignore-next-line boundary-violation
import { userHistoryMirror } from "../../db/schema/catalog";
import { registerScheduledPerRow } from "../../jobs/scheduled-per-row";
import { buildContext, composeLayout } from "../service";
import { write as writeLayoutCache } from "../internal/layout-cache";

const ACTIVE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
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
 * keys it by user id (the row it iterates), but a sustained run of failures
 * reflects a shared upstream plugin source being slow or offline. Once a
 * source trips the threshold it is skipped for the remainder of the run
 * instead of paying the full per-row timeout again.
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

interface ActiveUserRow {
  userId: string;
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
 * Returns every user with activity in the last 14 days. "Activity" = either
 * a feedback event (likes / ratings) or a fresh history-mirror sync. The
 * union keeps users who watch but never rate eligible for warm fills.
 *
 * Reads `feedback` (owned by preferences) and `userHistoryMirror` (owned by
 * catalog) directly — both imports carry `fallow-ignore-next-line
 * boundary-violation` directives under TASK-046 with the same reason: the
 * warm job is the sole cross-module query path here, and routing through
 * service barrels would require adding cross-module list-user-id surfaces
 * on `preferences` and `catalog` purely for this job. The barrel additions
 * are deferred to a follow-up so this PR stays scoped to the layout
 * retrofit and the parallel Phase 3d catalog refactor can shape its own
 * surface without merge churn.
 */
export async function listActiveUsers(now: number = Date.now()): Promise<ActiveUserRow[]> {
  const db = getDb();
  const cutoff = now - ACTIVE_WINDOW_MS;
  const recentFeedback = await db
    .selectDistinct({ userId: feedback.userId })
    .from(feedback)
    .where(sql`${feedback.createdAt} >= ${cutoff}`)
    .all();
  const recentHistory = await db
    .selectDistinct({ userId: userHistoryMirror.userId })
    .from(userHistoryMirror)
    .where(sql`${userHistoryMirror.lastSyncedAt} >= ${cutoff}`)
    .all();
  const ids = new Set<string>();
  for (const row of [...recentFeedback, ...recentHistory]) ids.add(row.userId);
  return [...ids].map((userId) => ({ userId }));
}

/**
 * Drives one warm-compose row through `breaker`. Skips the compose when the
 * source has already tripped the breaker (so the run stops paying the per-row
 * timeout on a known-dead upstream); otherwise records the outcome so the
 * breaker can trip after enough consecutive failures. Re-throws on failure so
 * the per-row runner still captures the error and updates run aggregates.
 *
 * Exported for the regression test, which drives the breaker directly without
 * the scheduler.
 */
export async function runWarmRow(breaker: CircuitBreaker, userId: string): Promise<void> {
  if (breaker.shouldSkip(userId)) return;
  try {
    await runWarmComposeForUser(userId);
    breaker.recordSuccess(userId);
  } catch (err) {
    breaker.recordFailure(userId);
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
