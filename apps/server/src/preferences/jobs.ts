import {
  PROFILE_MEDIA_TYPES,
  type ProfileMediaType,
  type RebuildResult,
} from "@ent-mcp/shared/preferences";

import { getCatalogService } from "../catalog";
import { writeRecommendationsForUser } from "../catalog/jobs/recommendation-build";
import { registerCoalesced } from "../jobs/coalesced";
import { registerScheduledPerRow } from "../jobs/scheduled-per-row";
import { registerTriggerable } from "../jobs/triggerable";
import type { JobRunContext } from "../jobs/types";
import { CatalogPreferenceProvider, type FeatureCacheMetrics } from "./catalog-provider";
import { getPreferenceEngine } from "./index";
import { listUsersNeedingDailyRebuild, type RebuildRow } from "./rebuild-row-source";
import { profileStorage } from "./storage";
import consola from "consola";

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
    // fallow-ignore-next-line complexity
    handler: async (ctx, input) => {
      if (!input?.userId) {
        ctx.logger.warn("Aborted: userId is required in input");
        throw new Error("userId is required");
      }

      const startTime = performance.now();
      const startedAt = new Date().toISOString();
      const userId = input.userId;

      ctx.logger.info(`Starting manual rebuild`, {
        jobId: PREFERENCE_MANUAL_REBUILD_JOB_ID,
        userId,
        timestamp: startedAt,
      });

      try {
        const { results, warnings, traces } = await rebuildPartitions(userId, ctx);

        // Mirror the nightly catalog rec build so the manual trigger surfaces
        // a fresh recommendation list immediately rather than waiting for the
        // next 02:00 sweep. The per-partition rebuild above already bumped
        // `profile_version`; `writeRecommendationsForUser` skips the rebuild
        // step and only writes the rec list against the freshly-versioned
        // profile.
        const catalog = getCatalogService();
        const recStart = performance.now();
        let recWriteFailed = false;
        try {
          await writeRecommendationsForUser({ catalog }, userId, ctx.abortSignal, (msg) =>
            ctx.logger.debug(msg),
          );
        } catch (recErr) {
          recWriteFailed = true;
          warnings.push(
            `Recommendation list write failed: ${recErr instanceof Error ? recErr.message : String(recErr)}`,
          );
        }
        const recWriteDurationMs = Math.round(performance.now() - recStart);

        // Read the persisted rec list back so the end-of-run summary can
        // report what was actually written. Diagnostic-only — a read failure
        // here must not fail the job, since the rebuild itself succeeded.
        const recSummary = await readRecListSummary(catalog, userId).catch(() => null);

        const durationMs = Math.round(performance.now() - startTime);
        const partitionSummary = summarisePartitions(results, traces);

        const endLog = {
          userId,
          durationMs,
          partitions: partitionSummary,
          recList: {
            written: !recWriteFailed,
            durationMs: recWriteDurationMs,
            itemCount: recSummary?.itemCount ?? null,
            profileVersion: recSummary?.profileVersion ?? null,
            generatedAt: recSummary?.generatedAt ?? null,
          },
          warningCount: warnings.length,
          warnings,
          results,
        };

        if (warnings.length > 0) {
          ctx.logger.warn(`Completed with warnings for user ${userId}`, endLog);
        } else {
          ctx.logger.success(`Completed successfully for user ${userId}`, endLog);
        }

        return { startedAt, rebuiltAt: new Date().toISOString(), durationMs, results, warnings };
      } catch (error) {
        const durationMs = Math.round(performance.now() - startTime);
        ctx.logger.error(`Failed for user ${userId}`, {
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

interface RecListSummary {
  itemCount: number;
  profileVersion: number;
  generatedAt: number;
}

async function readRecListSummary(
  catalog: ReturnType<typeof getCatalogService>,
  userId: string,
): Promise<RecListSummary | null> {
  const list = await catalog.getRecommendations(userId, "default");
  if (!list) return null;
  return {
    itemCount: list.items.length,
    profileVersion: list.profileVersion,
    generatedAt: list.generatedAt,
  };
}

interface PartitionSummary {
  sampleSize: number;
  confidence: string;
  durationMs: number;
  cache: FeatureCacheMetrics | null;
  cacheHitRatio: number | null;
  lastRebuiltAt: number | null;
  profileVersion: number | null;
}

function summarisePartitions(
  results: Partial<Record<ProfileMediaType, RebuildResult>>,
  traces: Partial<Record<ProfileMediaType, PartitionTrace>>,
): Partial<Record<ProfileMediaType, PartitionSummary>> {
  const summary: Partial<Record<ProfileMediaType, PartitionSummary>> = {};
  for (const mediaType of PROFILE_MEDIA_TYPES) {
    const result = results[mediaType];
    if (!result) continue;
    const trace = traces[mediaType];
    const cache = trace?.cache ?? null;
    const lookups = cache ? cache.hits + cache.misses : 0;
    const cacheHitRatio = cache && lookups > 0 ? cache.hits / lookups : null;
    summary[mediaType] = {
      sampleSize: result.sampleSize,
      confidence: result.confidence,
      durationMs: trace?.durationMs ?? 0,
      cache,
      cacheHitRatio,
      lastRebuiltAt: trace?.lastRebuiltAt ?? null,
      profileVersion: trace?.profileVersion ?? null,
    };
  }
  return summary;
}

interface PartitionTrace {
  durationMs: number;
  cache: FeatureCacheMetrics | null;
  lastRebuiltAt: number | null;
  profileVersion: number | null;
}

async function rebuildPartitions(
  userId: string,
  ctx: JobRunContext,
): Promise<{
  results: Partial<Record<ProfileMediaType, RebuildResult>>;
  warnings: string[];
  traces: Partial<Record<ProfileMediaType, PartitionTrace>>;
}> {
  const engine = getPreferenceEngine();
  const provider = engine.provider;
  const cacheAware = provider instanceof CatalogPreferenceProvider ? provider : null;
  // Drain any counters that accumulated outside this job (e.g. an
  // overlapping rank call) so the first partition sees a clean slate.
  cacheAware?.consumeFeatureCacheMetrics();

  const results: Partial<Record<ProfileMediaType, RebuildResult>> = {};
  const traces: Partial<Record<ProfileMediaType, PartitionTrace>> = {};
  const warnings: string[] = [];
  for (const mediaType of PROFILE_MEDIA_TYPES) {
    const typeStartTime = performance.now();
    const result = await engine.rebuildProfile(userId, mediaType, ctx.abortSignal);
    const typeDurationMs = Math.round(performance.now() - typeStartTime);
    const cache = cacheAware?.consumeFeatureCacheMetrics() ?? null;
    const stored = await profileStorage.read(userId, mediaType).catch(() => null);
    results[mediaType] = result;
    traces[mediaType] = {
      durationMs: typeDurationMs,
      cache,
      lastRebuiltAt: stored?.lastRebuiltAt ?? null,
      profileVersion: stored?.version ?? null,
    };
    if (result.sampleSize === 0) {
      warnings.push(`Profile for ${mediaType} was rebuilt with 0 sample size`);
    } else if (result.confidence === "low") {
      warnings.push(`Profile for ${mediaType} has low confidence (insufficient data points)`);
    }
    ctx.logger.debug(`Processed media type: ${mediaType}`, {
      userId,
      mediaType,
      durationMs: typeDurationMs,
      sampleSize: result.sampleSize,
      confidence: result.confidence,
      cache,
      lastRebuiltAt: traces[mediaType]?.lastRebuiltAt,
      profileVersion: traces[mediaType]?.profileVersion,
    });
  }
  return { results, warnings, traces };
}
