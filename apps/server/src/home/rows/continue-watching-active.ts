import { z } from "zod";
import { orderBy } from "es-toolkit/array";
import { decodeCursor, encodeCursor } from "../cursor";
import { fromContinueWatchingEntry } from "../adapters";
import type { RowProvider } from "../types";

const PAGE_SIZE = 12;
const FINISHING_THRESHOLD = 0.85;

const cursorSchema = z.object({ offset: z.number().int().min(0) });

/**
 * Active-resume entries: any item with non-zero progress under the
 * "finishing soon" threshold. Sorted by `lastPlayedAt` descending so the
 * most recently watched title stays on top.
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
    const res = await ctx.mediaService.getContinueWatchingFeed({ deadlineMs: ctx.deadlineMs });
    const eligible = res.items.filter((entry) => {
      const ms = entry.progressMs;
      if (ms === undefined || ms <= 0) return false;
      const total = entry.item.durationSec;
      if (total === undefined || total <= 0) return true;
      return ms / 1000 / total < FINISHING_THRESHOLD;
    });
    const sorted = orderBy(eligible, [(entry) => entry.lastPlayedAt ?? ""], ["desc"]);
    const slice = sorted.slice(page.offset, page.offset + PAGE_SIZE);
    const items = slice
      .map((entry) => fromContinueWatchingEntry(entry))
      .filter((item): item is NonNullable<typeof item> => item !== null);
    const next =
      sorted.length > page.offset + PAGE_SIZE
        ? encodeCursor({ offset: page.offset + PAGE_SIZE })
        : null;
    return { items, cursor: next, partial: res.partial };
  },
};

export default provider;
