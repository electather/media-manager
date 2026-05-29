import type { CompactMediaItem } from "@ent-mcp/shared/home";
import type { WatchlistSource } from "@ent-mcp/shared/watchlist";
import type { ApiErrorBody } from "@/shared/lib/diagnostics/api-error-body";
import * as m from "@/paraglide/messages";

/**
 * Watchlist card shape. The server unified its wire item on `CompactMediaItem`
 * (the shared `WatchlistItem` superset was deleted in the media-pipeline
 * consolidation), so the client follows: `addedAt`/`addedSource` are now
 * optional/nullable on the wire. Components that need them guard for absence.
 */
export type WatchlistItem = CompactMediaItem;

// fallow-ignore-next-line code-duplication
export class WatchlistApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | null;
  readonly code: string | undefined;

  // fallow-ignore-next-line complexity
  constructor(status: number, body: ApiErrorBody | null) {
    super(body?.message ?? body?.devMessage ?? `watchlist request failed (${status})`);
    this.name = "WatchlistApiError";
    this.status = status;
    this.body = body;
    this.code = typeof body?.code === "string" ? body.code : undefined;
  }
}

/** Localized label for an item's `addedSource` field. */
// fallow-ignore-next-line complexity
export function sourceLabel(source: WatchlistSource): string {
  switch (source) {
    case "manual":
      return m.watchlist_source_manual();
    case "plugin":
      return m.watchlist_source_plugin();
    case "search":
      return m.watchlist_source_search();
    case "notification":
      return m.watchlist_source_notification();
    case "recommended":
      return m.watchlist_source_recommended();
    case "trending":
      return m.watchlist_source_trending();
  }
}

export type { WatchlistCounts } from "@ent-mcp/shared/watchlist";

// Per-card status overlay consumed by `classify.ts`. The bucket axis lives
// on the server now (`WatchlistBucket`); this local enum keeps `in-progress`
// distinct from `available` for card chrome only.
export type WatchlistStatus =
  | "available"
  | "in-progress"
  | "requested"
  | "unavailable"
  | "upcoming"
  | "unknown";

export interface WatchlistBuckets {
  available: WatchlistItem[];
  inProgress: WatchlistItem[];
  requested: WatchlistItem[];
  unavailable: WatchlistItem[];
  upcoming: WatchlistItem[];
}
