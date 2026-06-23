import type { ConsolaInstance } from "consola";
import type { CanonicalMetadata } from "@nama/shared/catalog";
import type { ActiveRow } from "@nama/shared/media";
import { keyToId } from "@nama/shared/watchlist";
import type { CatalogService } from "../../catalog";
import { loadProgressMap, type ProgressMap } from "../progress";
import type { MediaEnrichService, MediaProgressService } from "../types";

/**
 * Deliberately structural so both watchlist sites (`log`) and pipeline's `listRows` (`logger`)
 * can feed it — `listRows` bridges them (US-007). Reuses `loadProgressMap` unchanged,
 * so `log`/`deadlineMs` match `MediaProgressContext`.
 */
export interface BatchLoadContext {
  mediaService: MediaEnrichService & MediaProgressService;
  catalog: Pick<CatalogService, "getMetadataBatch">;
  log: ConsolaInstance;
  deadlineMs?: number;
}

/**
 * Shared status + metadata + progress fan-out result. `progress` is the bare map
 * (wrapper's `partial` is folded into top-level `partial`). `partial` is true when any
 * sub-load soft-failed, indicating degraded signal.
 */
export interface BatchLoadResult {
  statuses: Record<string, string>;
  metadata: Record<string, CanonicalMetadata>;
  progress: ProgressMap;
  partial: boolean;
}

/**
 * Single status + metadata + progress fan-out (design §C/§F), collapsing copies in
 * `watchlist` and `enrich`. Each sub-load is warn-and-fallback: logs rejection, returns empty,
 * flips `partial`. Single failures never sink others — page renders from resolved signals.
 */
export async function batchLoad(
  rows: ReadonlyArray<Pick<ActiveRow, "tmdbId" | "mediaType">>,
  ctx: BatchLoadContext,
): Promise<BatchLoadResult> {
  if (rows.length === 0) {
    return { statuses: {}, metadata: {}, progress: new Map(), partial: false };
  }

  const compositeIds = rows.map((r) => keyToId({ tmdbId: r.tmdbId, mediaType: r.mediaType }));
  const metadataKeys = rows.map((r) => ({ tmdbId: r.tmdbId, type: r.mediaType }));

  let partial = false;
  const [statuses, metadata, progress] = await Promise.all([
    ctx.mediaService.getStatusBatch(compositeIds).catch((err) => {
      ctx.log.warn("[media:batch-load] getStatusBatch failed", err);
      partial = true;
      return {} as Record<string, string>;
    }),
    ctx.catalog.getMetadataBatch(metadataKeys).catch((err) => {
      ctx.log.warn("[media:batch-load] getMetadataBatch failed", err);
      partial = true;
      return {} as Record<string, CanonicalMetadata>;
    }),
    // `loadProgressMap` already warns and falls back to an empty map on a
    // failed continue-watching feed, surfacing its own `partial` flag.
    loadProgressMap(ctx),
  ]);

  if (progress.partial) partial = true;

  return { statuses, metadata, progress: progress.map, partial };
}
