import { z } from "zod";
import { decodeCursor, encodeCursor } from "../internal/cursor";
import { fromContinueWatchingEntry } from "../internal/adapters";
import type { RowProvider } from "../internal/types";
import { continueWatchingActiveSource } from "../sources/continue-watching";

const PAGE_SIZE = 12;

const cursorSchema = z.object({ offset: z.number().int().min(0) });

/**
 * Active-resume entries: any item with non-zero progress under the
 * "finishing soon" threshold. The filter + `lastPlayedAt` ordering moved into
 * `continueWatchingActiveSource.fetchRawSet`; this row keeps only the offset
 * slice, the entry → `CompactMediaItem` projection, and the cursor.
 */
const provider: RowProvider = {
  rowId: "continueWatching-active",
  kind: "continueWatching",
  titleKey: "home_row_continueWatching_header",
  async eligibility(ctx) {
    return ctx.mediaService.hasCapabilityProvider("continueWatching", "v1", "user");
  },
  async initialCursor() {
    return null;
  },
  async fetchPage(ctx, cursor) {
    const page = cursor === null ? { offset: 0 } : decodeCursor(cursor, cursorSchema);
    const { rows, partial } = await continueWatchingActiveSource.fetchRawSet(ctx, undefined, null);
    const slice = rows.slice(page.offset, page.offset + PAGE_SIZE);
    const items = slice
      .map((entry) => fromContinueWatchingEntry(entry))
      .filter((item): item is NonNullable<typeof item> => item !== null);
    const next =
      rows.length > page.offset + PAGE_SIZE
        ? encodeCursor({ offset: page.offset + PAGE_SIZE })
        : null;
    return { items, cursor: next, partial };
  },
};

export default provider;
