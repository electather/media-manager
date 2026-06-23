import type { MediaSourceId } from "@nama/shared/media";
import { type ClientMediaSource, defineMediaSource } from "@/shared/media/source";

/** Cursor carries the seed; empty params keep cache key stable per row. */
export type HomeRowParams = Record<string, never>;

/**
 * rowId typed as MediaSourceId to prevent unknown slugs flowing into resolver.
 * cursorOnNull: "throw" mirrors server's "400" policy (invariant V.CU1).
 */
export function homeRowSource(
  rowId: MediaSourceId,
  initialCursor: string | null,
): ClientMediaSource<HomeRowParams> {
  return defineMediaSource<HomeRowParams>({
    sourceId: rowId,
    params: {},
    mode: "infinite",
    cursorOnNull: "throw",
    initialCursor,
  });
}
