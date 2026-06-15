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

/**
 * Maximum number of rows whose availability probes run concurrently in one
 * hydrate pass. Each row fires two plugin calls (`getMatchingServers` +
 * `getAvailabilityQuality`), so a large stale-row set could otherwise launch
 * unbounded concurrent requests and trigger provider rate-limit bans or
 * socket exhaustion. Matches the `BATCH_SIZE` convention in the catalog
 * metadata-refresh job.
 */
export const HYDRATE_CONCURRENCY = 25;

/**
 * Hydrates the denormalized browse projection for a user's new and stale owned
 * rows (design §Sync + hydrate, phase 2). For each stale row it folds together
 * three independent sources and tolerates any of them being absent — a partial
 * hydrate is valid and self-heals on the next pass:
 *   - catalog metadata (`getMetadataBatch`) → sortTitle, year, genres, franchise,
 *   - per-key `getMatchingServers` → server chips,
 *   - per-key `getAvailabilityQuality` → quality tiers (the N-call fan-out),
 *   - `loadProgressMap` → watchedState.
 *
 * The availability fan-out runs in chunks of {@link HYDRATE_CONCURRENCY} rows so
 * at most 2 × HYDRATE_CONCURRENCY plugin calls are in-flight at once, preventing
 * provider rate-limit bans and socket exhaustion for large libraries. Returns
 * counts for run-status visibility. A fully-fresh library short-circuits to
 * zero work.
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
  // Fan out in bounded chunks to cap concurrent plugin calls. Each chunk runs
  // its rows fully before the next chunk starts, so at most
  // 2 × HYDRATE_CONCURRENCY plugin requests are in-flight at once.
  //
  // Persist each chunk's projection as soon as it resolves rather than buffering
  // every update for one write after the loop. The hydrate jobs cap a user row
  // at a wall-clock timeout (30s for `library.sync`, 60s for `library.hydrate`)
  // and abandon the row's in-flight work when it fires, while the availability
  // probes run unbounded (no per-probe deadline in the scheduled path). Writing
  // per chunk means a row that times out mid-pass keeps the chunks that already
  // finished — `writeHydration` stamps `hydratedAt`, so the next run's
  // `staleOrNew` skips them and resumes from where this pass stopped instead of
  // redoing completed work.
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

/**
 * Fetches catalog metadata for every stale row in one batch, keyed by the
 * composite id so `buildUpdate` does an O(1) lookup. Tolerates a metadata miss:
 * a key absent from the result simply hydrates its metadata-sourced columns to
 * their empty/null shape.
 */
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

/**
 * Folds the three sources into one row's denormalized projection. The
 * availability lookups (`getMatchingServers`, `getAvailabilityQuality`) are the
 * only awaits here; metadata and progress are already loaded. Each source is
 * null-safe so any single failure degrades that column, not the row.
 */
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
