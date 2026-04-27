import {
  PROFILE_MEDIA_TYPES,
  type ProfileMediaType,
  type RebuildResult,
} from "@ent-mcp/shared/preferences";
import { consola } from "consola";
import { and, eq, gt, sql } from "drizzle-orm";
import { getCatalogService } from "../catalog";
import { writeRecommendationsForUser } from "../catalog/jobs";
import { getDb } from "../db/client";
import { feedback, preferenceProfiles } from "../db/schema";
import { registerCoalesced } from "../jobs/coalesced";
import { registerScheduledPerRow } from "../jobs/scheduled-per-row";
import { registerTriggerable } from "../jobs/triggerable";
import { getPreferenceEngine } from "./index";

export const PREFERENCE_DAILY_JOB_ID = "host.preference.daily_rebuild";
export const PREFERENCE_INCREMENTAL_JOB_ID = "host.preference.incremental_update";
export const PREFERENCE_MANUAL_REBUILD_JOB_ID = "feature.preference.rebuild";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const INCREMENTAL_REBUILD_THRESHOLD = 20;
// `host.catalog.recommendation_build` runs at 02:00 and rebuilds the same
// per-user partitions before writing its rec list. The daily safety-net
// sweep at 03:00 should skip any user whose profile is already fresher
// than this threshold so we don't redo the work unnecessarily.
const DAILY_FRESH_PROFILE_WINDOW_MS = 6 * 60 * 60 * 1000;

export interface RebuildRow {
  userId: string;
}

/**
 * Registers the three jobs the preference engine owns. Called once at host
 * startup alongside other scheduler registrations.
 */
export function registerPreferenceJobs(): void {
  registerScheduledPerRow<RebuildRow>({
    id: PREFERENCE_DAILY_JOB_ID,
    name: "Daily preference rebuild",
    description: "Rebuilds preference profiles for users with stale or missing profiles.",
    // Offset behind `host.catalog.recommendation_build` (02:00) so the two
    // jobs do not race `profile_version` on the same user set. The catalog
    // rec build already rebuilds profiles before writing its list; this
    // sweep stays as the safety net for users the catalog job did not touch
    // (e.g. row-source mid-flight failure) and runs once the rec window has
    // settled.
    schedule: "0 3 * * *",
    adminTriggerable: true,
    rowSource: () => listUsersNeedingDailyRebuild(),
    handler: async (ctx, row) => {
      const engine = getPreferenceEngine();
      await engine.rebuildProfile(row.userId, "movie", ctx.abortSignal);
      await engine.rebuildProfile(row.userId, "tv", ctx.abortSignal);
      await engine.rebuildProfile(row.userId, "combined", ctx.abortSignal);
    },
    perRowTimeoutSec: 120,
    runTimeoutSec: 60 * 60,
    continueOnRowError: true,
  });

  registerCoalesced({
    id: PREFERENCE_INCREMENTAL_JOB_ID,
    name: "Incremental preference update",
    description: "Debounced incremental update triggered by user feedback.",
    debounceMs: 30_000,
    maxWaitMs: 5 * 60_000,
    scopeKey: (input) => String((input as { userId?: string }).userId ?? ""),
    handler: async (_ctx, _triggerCount, scopeKey) => {
      if (!scopeKey) return;
      await getPreferenceEngine().applyIncrementalUpdate(scopeKey);
    },
    timeoutSec: 60,
  });

  registerTriggerable<
    { userId: string },
    {
      startedAt: string;
      rebuiltAt: string;
      durationMs: number;
      results: Partial<Record<ProfileMediaType, RebuildResult>>;
      warnings: string[];
    }
  >({
    id: PREFERENCE_MANUAL_REBUILD_JOB_ID,
    name: "Rebuild preference profile",
    description: "Full rebuild of a user's preference profile on demand.",
    handler: async (ctx, input) => {
      if (!input?.userId) {
        consola.warn("[job:feature.preference.rebuild] Aborted: userId is required in input");
        throw new Error("userId is required");
      }

      const startTime = performance.now();
      const startedAt = new Date().toISOString();
      const userId = input.userId;

      consola.info(`[job:feature.preference.rebuild] Starting manual rebuild`, {
        jobId: PREFERENCE_MANUAL_REBUILD_JOB_ID,
        userId,
        timestamp: startedAt,
      });

      const engine = getPreferenceEngine();
      const results: Partial<Record<ProfileMediaType, RebuildResult>> = {};
      const warnings: string[] = [];

      try {
        for (const mediaType of PROFILE_MEDIA_TYPES) {
          const typeStartTime = performance.now();
          const result = await engine.rebuildProfile(userId, mediaType, ctx.abortSignal);
          const typeDurationMs = Math.round(performance.now() - typeStartTime);

          results[mediaType] = result;

          if (result.sampleSize === 0) {
            warnings.push(`Profile for ${mediaType} was rebuilt with 0 sample size`);
          } else if (result.confidence === "low") {
            warnings.push(`Profile for ${mediaType} has low confidence (insufficient data points)`);
          }

          consola.debug(`[job:feature.preference.rebuild] Processed media type: ${mediaType}`, {
            userId,
            mediaType,
            durationMs: typeDurationMs,
            sampleSize: result.sampleSize,
            confidence: result.confidence,
          });
        }

        // Mirror the nightly catalog rec build so the manual trigger surfaces
        // a fresh recommendation list immediately rather than waiting for the
        // next 02:00 sweep. The per-partition rebuild above already bumped
        // `profile_version`; `writeRecommendationsForUser` skips the rebuild
        // step and only writes the rec list against the freshly-versioned
        // profile.
        try {
          await writeRecommendationsForUser(
            { catalog: getCatalogService() },
            userId,
            ctx.abortSignal,
            (msg) => consola.debug(msg),
          );
        } catch (recErr) {
          warnings.push(
            `Recommendation list write failed: ${recErr instanceof Error ? recErr.message : String(recErr)}`,
          );
        }

        const durationMs = Math.round(performance.now() - startTime);

        if (warnings.length > 0) {
          consola.warn(
            `[job:feature.preference.rebuild] Completed with warnings for user ${userId}`,
            {
              userId,
              durationMs,
              warnings,
              results,
            },
          );
        } else {
          consola.success(
            `[job:feature.preference.rebuild] Completed successfully for user ${userId}`,
            {
              userId,
              durationMs,
              results,
            },
          );
        }

        return {
          startedAt,
          rebuiltAt: new Date().toISOString(),
          durationMs,
          results,
          warnings,
        };
      } catch (error) {
        const durationMs = Math.round(performance.now() - startTime);
        consola.error(`[job:feature.preference.rebuild] Failed for user ${userId}`, {
          userId,
          durationMs,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        throw error;
      }
    },
    scopeKey: (input) => input.userId,
    requiredPermission: {
      kind: "feature",
      check: async (userId, input) => {
        const typed = input as { userId?: string } | null;
        return typeof typed?.userId === "string" && typed.userId === userId;
      },
    },
    inputSchema: {
      type: "object",
      properties: { userId: { type: "string", "x-picker": "user" } },
      required: ["userId"],
      additionalProperties: false,
    },
    timeoutSec: 600,
  });

  consola.debug("[preference] registered daily, incremental, and manual-rebuild jobs");
}

/**
 * Drives the daily rebuild row source. Unions three conditions: first-run
 * users (any activity, no profile), stale-profile users, and users whose
 * incremental buffer has accumulated enough signal to warrant a full rebuild.
 */
export async function listUsersNeedingRebuild(now: number = Date.now()): Promise<RebuildRow[]> {
  const db = getDb();

  const firstRun = await db
    .selectDistinct({ userId: feedback.userId })
    .from(feedback)
    .leftJoin(preferenceProfiles, eq(preferenceProfiles.userId, feedback.userId))
    .where(sql`${preferenceProfiles.userId} IS NULL`)
    .all();

  const stale = await db
    .selectDistinct({ userId: preferenceProfiles.userId })
    .from(preferenceProfiles)
    .where(sql`${preferenceProfiles.lastRebuiltAt} < ${now - SEVEN_DAYS_MS}`)
    .all();

  const bursty = await db
    .select({ userId: feedback.userId })
    .from(feedback)
    .innerJoin(preferenceProfiles, eq(preferenceProfiles.userId, feedback.userId))
    .where(and(gt(feedback.createdAt, preferenceProfiles.lastRebuiltAt)))
    .groupBy(feedback.userId)
    .having(sql`count(${feedback.id}) >= ${INCREMENTAL_REBUILD_THRESHOLD}`)
    .all();

  const ids = new Set<string>();
  for (const row of [...firstRun, ...stale, ...bursty]) {
    ids.add(row.userId);
  }
  return [...ids].map((userId) => ({ userId }));
}

/**
 * Filtered row source for `host.preference.daily_rebuild`. Drops users
 * whose `combined` profile was rebuilt within `DAILY_FRESH_PROFILE_WINDOW_MS`
 * — those users were already covered by the 02:00 catalog rec-build run.
 * Users without a profile and users whose latest rebuild predates the
 * window stay in the row source so the safety-net sweep still corrects
 * any users the catalog job missed.
 */
export async function listUsersNeedingDailyRebuild(
  now: number = Date.now(),
): Promise<RebuildRow[]> {
  const candidates = await listUsersNeedingRebuild(now);
  if (candidates.length === 0) return candidates;
  const db = getDb();
  const freshCutoff = now - DAILY_FRESH_PROFILE_WINDOW_MS;
  const fresh = await db
    .select({ userId: preferenceProfiles.userId })
    .from(preferenceProfiles)
    .where(
      and(
        eq(preferenceProfiles.mediaType, "combined"),
        sql`${preferenceProfiles.lastRebuiltAt} >= ${freshCutoff}`,
      ),
    )
    .all();
  const skip = new Set(fresh.map((row) => row.userId));
  return candidates.filter((row) => !skip.has(row.userId));
}
