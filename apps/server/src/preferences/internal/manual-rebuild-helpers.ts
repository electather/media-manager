import {
  PROFILE_MEDIA_TYPES,
  type ProfileMediaType,
  type RebuildResult,
} from "@nama/shared/preferences";
import type { CatalogService } from "../../catalog";
import type { JobRunContext } from "../../jobs/types";
import type { FeatureCacheMetrics } from "./catalog-provider";
import { getPreferencesService } from "../service";

/**
 * Helpers factored from `jobs/manual-rebuild.ts` (200 LOC hard cap).
 * Used only by manual-rebuild handler; kept in `internal/` to avoid barrel exposure.
 */

export interface RecListSummary {
  itemCount: number;
  profileVersion: number;
  generatedAt: number;
}

export interface PartitionSummary {
  sampleSize: number;
  confidence: string;
  durationMs: number;
  cache: FeatureCacheMetrics | null;
  cacheHitRatio: number | null;
  lastRebuiltAt: number | null;
  profileVersion: number | null;
}

export interface PartitionTrace {
  durationMs: number;
  cache: FeatureCacheMetrics | null;
  lastRebuiltAt: number | null;
  profileVersion: number | null;
}

export async function readRecListSummary(
  catalog: CatalogService,
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

// fallow-ignore-next-line complexity
export function summarisePartitions(
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

// fallow-ignore-next-line complexity
export async function rebuildPartitions(
  userId: string,
  ctx: JobRunContext,
): Promise<{
  results: Partial<Record<ProfileMediaType, RebuildResult>>;
  warnings: string[];
  traces: Partial<Record<ProfileMediaType, PartitionTrace>>;
}> {
  const service = getPreferencesService();
  // Drain any counters that accumulated outside this job (e.g. an
  // overlapping rank call) so the first partition sees a clean slate.
  service.consumeFeatureCacheMetrics();

  const results: Partial<Record<ProfileMediaType, RebuildResult>> = {};
  const traces: Partial<Record<ProfileMediaType, PartitionTrace>> = {};
  const warnings: string[] = [];
  for (const mediaType of PROFILE_MEDIA_TYPES) {
    const typeStartTime = performance.now();
    const result = await service.rebuildProfile(userId, mediaType, ctx.abortSignal);
    const typeDurationMs = Math.round(performance.now() - typeStartTime);
    const cache = service.consumeFeatureCacheMetrics();
    const stored = await service.getStoredProfile(userId, mediaType).catch(() => null);
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
