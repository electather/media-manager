import { ROW_ASPECT } from "@/features/home/lib/home-feed-config";
import type { HomeMediaItem, RowData } from "@/features/home/lib/types";
import { encodeSeedCursor } from "@/shared/media/cursor";

/** Must use `encodeSeedCursor` to match server resolver expectations; pre-cutover `encodeCursor` shape caused 400 errors. */
export function buildRelatedRow(item: HomeMediaItem): RowData {
  return {
    id: "similarTo",
    kind: "similarTo",
    initialCursor: encodeSeedCursor({ seedId: item.tmdbId, seedType: item.mediaType }),
    defaultAspect: ROW_ASPECT["similarTo"],
  };
}
