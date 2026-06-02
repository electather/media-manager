import type { ConsolaInstance } from "consola";
import type { CanonicalMetadata } from "@ent-mcp/shared/catalog";
import type { ActiveRow } from "@ent-mcp/shared/media";
import { keyToId } from "@ent-mcp/shared/watchlist";
import type { CatalogService } from "../../catalog";
import { loadProgressMap, type ProgressMap } from "../progress";
import type { MediaEnrichService, MediaProgressService } from "../types";

/**
 * Minimal per-call surface `batchLoad` needs. Deliberately structural rather
 * than the full `SourceContext` so the existing watchlist fan-out sites (which
 * carry `log`) and the pipeline's `listRows` (which carries `logger`) can both
 * feed it — `listRows` bridges `logger` → `log` when it calls in (US-007).
 * `loadProgressMap` is reused unchanged, so `log`/`deadlineMs` match its
 * `MediaProgressContext`.
 */
export interface BatchLoadContext {
  mediaService: MediaEnrichService & MediaProgressService;
  catalog: Pick<CatalogService, "getMetadataBatch">;
  log: ConsolaInstance;
  deadlineMs?: number;
}

/**
 * The shared status + metadata + progress fan-out result. `progress` is the
 * bare resume-position map (the `{ map, partial }` wrapper's `partial` is
 * folded into the top-level `partial`); `partial` is true when any sub-load
 * soft-failed and the row set was filled from a degraded signal.
 */
export interface BatchLoadResult {
  statuses: Record<string, string>;
  metadata: Record<string, CanonicalMetadata>;
  progress: ProgressMap;
  partial: boolean;
}

/**
 * The single status-batch + metadata-batch + progress-map fan-out (design
 * §C/§F), collapsing the hand-written `Promise.all([...])` copies in
 * `watchlist` (`listItemsOffset`, `tonight/section`, `filterByMood`) and
 * `enrich`'s internal call into one definition.
 *
 * Each sub-load is warn-and-fallback: a rejected lookup is logged, replaced
 * with an empty result, and flips `partial` so the consumer envelope surfaces
 * the degraded read instead of throwing. A single failed sub-load never sinks
 * the other two — the page still renders from whatever signals resolved.
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
