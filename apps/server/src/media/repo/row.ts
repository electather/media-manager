import type { ActiveRow } from "@ent-mcp/shared/media";
import type { WatchlistSource } from "@ent-mcp/shared/watchlist";
import { watchlistItems } from "../../db/schema/media";

export function toRow(raw: typeof watchlistItems.$inferSelect): ActiveRow {
  return {
    id: raw.id,
    userId: raw.userId,
    tmdbId: raw.tmdbId,
    mediaType: raw.mediaType,
    state: raw.state,
    source: raw.source as WatchlistSource,
    addedAt: raw.addedAt,
    removedAt: raw.removedAt,
    seeded: Boolean(raw.seeded),
  };
}
