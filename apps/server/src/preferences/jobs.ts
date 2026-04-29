import {
  PROFILE_MEDIA_TYPES,
  type ProfileMediaType,
  type RebuildResult,
} from "@ent-mcp/shared/preferences";
import { consola } from "consola";
import { getCatalogService } from "../catalog";
import { writeRecommendationsForUser } from "../catalog/jobs/recommendation-build";
import { registerCoalesced } from "../jobs/coalesced";
import { registerScheduledPerRow } from "../jobs/scheduled-per-row";
import { registerTriggerable } from "../jobs/triggerable";
import { getPreferenceEngine } from "./index";
import { listUsersNeedingDailyRebuild, type RebuildRow } from "./rebuild-row-source";

export { listUsersNeedingDailyRebuild } from "./rebuild-row-source";

export const PREFERENCE_DAILY_JOB_ID = "host.preference.daily_rebuild";
export const PREFERENCE_INCREMENTAL_JOB_ID = "host.preference.incremental_update";
export const PREFERENCE_MANUAL_REBUILD_JOB_ID = "feature.preference.rebuild";

/**
 * Registers the three jobs the preference engine owns. Called once at host
 * startup alongside other scheduler registrations.
 */
export function registerPreferenceJobs(): void {
  registerDailyRebuildJob();
  registerIncrementalUpdateJob();
  registerManualRebuildJob();
  consola.debug("[preference] registered daily, incremental, and manual-rebuild jobs");
}

function registerDailyRebuildJob(): void {
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
}

function registerIncrementalUpdateJob(): void {
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
}

function registerManualRebuildJob(): void {
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

      try {
        const { results, warnings } = await rebuildPartitions(userId, ctx.abortSignal);

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
            { userId, durationMs, warnings, results },
          );
        } else {
          consola.success(
            `[job:feature.preference.rebuild] Completed successfully for user ${userId}`,
            { userId, durationMs, results },
          );
        }

        return { startedAt, rebuiltAt: new Date().toISOString(), durationMs, results, warnings };
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
}

async function rebuildPartitions(
  userId: string,
  abortSignal: AbortSignal,
): Promise<{ results: Partial<Record<ProfileMediaType, RebuildResult>>; warnings: string[] }> {
  const engine = getPreferenceEngine();
  const results: Partial<Record<ProfileMediaType, RebuildResult>> = {};
  const warnings: string[] = [];
  for (const mediaType of PROFILE_MEDIA_TYPES) {
    const typeStartTime = performance.now();
    const result = await engine.rebuildProfile(userId, mediaType, abortSignal);
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
  return { results, warnings };
}
