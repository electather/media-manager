import type { CanonicalMetadata } from "@nama/shared/catalog";
import { loadProgressMap, type ProgressMap } from "../../media";
import { staleOrNew, writeHydration, type HydrateTarget, type HydrationUpdate } from "../repo";
import type { LibraryContext } from "../types";
import { normalizeSortTitle } from "./normalize-title";
import { deriveQualityTiers } from "./quality-tier";
import { deriveWatchedState } from "./watched-state";

/** Default staleness window the membership sync uses when it triggers a hydrate. */
export const HYDRATE_DEFAULT_STALE_TTL_MS = 6 * 60 * 60 * 1000;

/** Tuning knobs for one hydrate pass. */
export interface HydrateOptions {
  /**
   * A row whose `hydratedAt` is older than this is re-hydrated. The hourly
   * availability re-hydrate passes a 1-hour window; the membership sync passes
   * the 6-hour default so it only touches genuinely new or long-stale rows.
   */
  staleTtlMs?: number;
}

/** Counts surfaced for run-status visibility. */
export interface HydrateResult {
  /** Rows that needed hydrating (missing or stale projection). */
  considered: number;
  /** Rows whose denormalized projection was written this pass. */
  hydrated: number;
}

/**
 * The two batch-loaded sources every row's projection reads from, bundled so
 * `buildUpdate` stays within the three-logical-param budget. Per-row server and
 * quality probes are NOT batched — they fan out inside `buildUpdate`.
 */
interface BatchSources {
  metadata: Record<string, CanonicalMetadata>;
  progress: ProgressMap;
}

/** Caps concurrent availability probes (each row = 2 plugin calls). Matches catalog's BATCH_SIZE. */
export const HYDRATE_CONCURRENCY = 25;

/**
 * Hydrates denormalized projection for new/stale rows (design §Sync + hydrate, phase 2).
 * Folds catalog metadata, per-key availability probes, and progress—each source optional.
 * Runs in HYDRATE_CONCURRENCY chunks; per-chunk writes allow rows that timeout mid-pass
 * to keep finished chunks (hydratedAt stamp skips them on resume).
 */
export async function hydrate(
  ctx: LibraryContext,
  opts: HydrateOptions = {},
): Promise<HydrateResult> {
  const staleTtlMs = opts.staleTtlMs ?? HYDRATE_DEFAULT_STALE_TTL_MS;
  const now = Date.now();
  const targets = await staleOrNew(ctx.userId, staleTtlMs, now);
  if (targets.length === 0) return { considered: 0, hydrated: 0 };
  const sources: BatchSources = {
    metadata: await loadMetadata(ctx, targets),
    progress: await loadProgress(ctx),
  };
  // Chunked: at most 2 × HYDRATE_CONCURRENCY plugin calls in-flight.
  // Write per chunk: row timeout (30s sync, 60s hydrate) keeps finished chunks; hydratedAt
  // stamp makes staleOrNew resume from stop point, not redo completed work.
  let hydrated = 0;
  for (let i = 0; i < targets.length; i += HYDRATE_CONCURRENCY) {
    const slice = targets.slice(i, i + HYDRATE_CONCURRENCY);
    const chunkUpdates = await Promise.all(
      slice.map((target) => buildUpdate(ctx, target, sources)),
    );
    hydrated += await writeHydration(ctx.userId, chunkUpdates, now);
  }
  return { considered: targets.length, hydrated };
}

/** Batch-loads catalog metadata keyed by composite id. Miss tolerates: absent keys hydrate to null/[]. */
async function loadMetadata(
  ctx: LibraryContext,
  targets: HydrateTarget[],
): Promise<Record<string, CanonicalMetadata>> {
  const keys = targets.map((target) => ({ tmdbId: target.tmdbId, type: target.mediaType }));
  try {
    return await ctx.catalog.getMetadataBatch(keys);
  } catch (err) {
    ctx.log.warn("[library:hydrate] getMetadataBatch failed; hydrating without metadata", err);
    return {};
  }
}

/**
 * Loads the continue-watching progress map once per pass (it is itself
 * per-request memoized). On a total CW failure it returns an empty map so every
 * row hydrates `watchedState` to `null` rather than failing the pass.
 */
async function loadProgress(ctx: LibraryContext): Promise<ProgressMap> {
  const { map } = await loadProgressMap(ctx);
  return map;
}

/** Folds metadata, progress, and availability probes into row's denormalized projection. Null-safe per column. */
async function buildUpdate(
  ctx: LibraryContext,
  target: HydrateTarget,
  sources: BatchSources,
): Promise<HydrationUpdate> {
  const meta = sources.metadata[target.id];
  const { servers, qualityTiers } = await loadAvailability(ctx, target);
  return {
    id: target.id,
    sortTitle: normalizeSortTitle(meta?.title),
    year: meta?.year ?? null,
    genres: meta?.genres ?? [],
    servers,
    qualityTiers,
    watchedState: deriveWatchedState(sources.progress.get(target.id)),
    collectionId: meta?.collectionId ?? null,
    collectionName: meta?.collectionName ?? null,
  };
}

/**
 * Resolves a row's server chips and quality tiers from the availability
 * providers. The two probes run concurrently; either failing degrades only its
 * own column (empty array) so the row still hydrates the rest.
 */
async function loadAvailability(
  ctx: LibraryContext,
  target: HydrateTarget,
): Promise<{ servers: { id: string; label: string }[]; qualityTiers: string[] }> {
  const opts = ctx.deadlineMs != null ? { deadlineMs: ctx.deadlineMs } : {};
  const [servers, copies] = await Promise.all([
    ctx.mediaService.getMatchingServers(target.tmdbId, target.mediaType, opts).catch((err) => {
      ctx.log.warn("[library:hydrate] getMatchingServers failed", err);
      return [] as { id: string; label: string }[];
    }),
    ctx.mediaService.getAvailabilityQuality(target.tmdbId, target.mediaType, opts).catch((err) => {
      ctx.log.warn("[library:hydrate] getAvailabilityQuality failed", err);
      return [];
    }),
  ]);
  return { servers, qualityTiers: deriveQualityTiers(copies) };
}
