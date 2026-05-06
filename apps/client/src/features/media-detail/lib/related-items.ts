import type { RowKind } from "@ent-mcp/shared/home";
import { ROW_ASPECT } from "@/features/home/lib/home-feed-config";
import type { HomeMediaItem, RowData } from "@/features/home/lib/types";

const RELATED_ROW_KIND: RowKind = "recommendedForYou";

/**
 * Builds a synthetic `RowData` stub the detail page hands to `<Row>`. The
 * row scroller hits `useHomeRow` against the chosen registry slug, so the
 * detail "Related" strip rides whichever recommended-for-you row matches
 * the title's media type — the orchestrator already filters those by type.
 */
export function buildRelatedRow(item: HomeMediaItem): RowData {
  const rowId = item.mediaType === "tv" ? "recommendedForYou-tv" : "recommendedForYou-movies";
  return {
    id: rowId,
    kind: RELATED_ROW_KIND,
    initialCursor: null,
    defaultAspect: ROW_ASPECT[RELATED_ROW_KIND],
  };
}
