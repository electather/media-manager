import type { ActiveRow, RowSource } from "@ent-mcp/shared/media";
import { watchlistItems } from "../../db/schema/media";

export function toRow(raw: typeof watchlistItems.$inferSelect): ActiveRow {
  return {
    id: raw.id,
    userId: raw.userId,
    tmdbId: raw.tmdbId,
    mediaType: raw.mediaType,
    state: raw.state,
    source: raw.source as RowSource,
    addedAt: raw.addedAt,
    removedAt: raw.removedAt,
    seeded: Boolean(raw.seeded),
  };
}
