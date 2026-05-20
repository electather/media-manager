import type {
  WatchlistItem as SharedWatchlistItem,
  WatchlistSource,
} from "@ent-mcp/shared/watchlist";
import type { ApiErrorBody } from "@/shared/lib/diagnostics/api-error-body";
import * as m from "@/paraglide/messages";

export type WatchlistItem = SharedWatchlistItem;

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
export function sourceLabel(source: WatchlistSource): string {
  switch (source) {
    case "manual":
      return m.watchlist_source_manual();
    case "plugin":
      return m.watchlist_source_plugin();
    case "import":
      return m.watchlist_source_import();
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
