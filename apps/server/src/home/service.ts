import { consola, type ConsolaInstance } from "consola";
import type { HomeLayoutResponse } from "@ent-mcp/shared/home";
import { getCatalogService } from "../catalog";
import { MediaService, StatusBatchMemo } from "../media";
import * as layoutCache from "./internal/layout-cache";
import { composeLayoutLive } from "./internal/layout";
import type { RowContext } from "./internal/types";

export { composeSeasonAvailability } from "./internal/season-availability";
export { composeDetailsResponse as composeDetails } from "./internal/details";
export { composeRowPage as composeRow } from "./internal/row";
export { homeMediaSources } from "./internal/media-sources";

const DEFAULT_DEADLINE_MS = 8000;

export interface ComposeOptions {
  /** Skips the cache read; the warm job uses this to force a recompute. */
  forceFresh?: boolean;
  /**
   * Skips the detached cache writeback so the caller can run a synchronous
   * write itself, such as the warm job surfacing transient SQLite failures.
   */
  skipWriteback?: boolean;
}

/**
 * Builds the per-request context shared by every row provider, the hero
 * cascade, and the orchestrator passes themselves.
 */
export function buildContext(
  userId: string,
  logger: ConsolaInstance = consola,
  opts: { deadlineMs?: number } = {},
): RowContext {
  const mediaService = new MediaService(userId);
  return {
    userId,
    mediaService,
    catalog: getCatalogService(),
    statusBatch: new StatusBatchMemo(mediaService),
    logger,
    deadlineMs: opts.deadlineMs ?? Date.now() + DEFAULT_DEADLINE_MS,
  };
}

/**
 * Returns the cached layout when fresh, otherwise composes live from the
 * row registry and writes the fresh blob back in the background.
 */
// fallow-ignore-next-line complexity
export async function composeLayout(
  ctx: RowContext,
  opts: ComposeOptions = {},
): Promise<HomeLayoutResponse> {
  if (!opts.forceFresh) {
    const cached = await layoutCache.read(ctx.userId);
    if (cached && layoutCache.isFresh(cached)) return cached.layout;
  }

  const blob = await composeLayoutLive(ctx);
  if (!opts.skipWriteback) {
    void layoutCache
      .write(ctx.userId, blob)
      .catch((err) => ctx.logger.warn("[home:layout-cache] write failed", err));
  }
  return blob;
}
