import { last, orderBy } from "es-toolkit/array";
import type { CompactMediaItem, RowKind } from "@ent-mcp/shared/home";
import type { RowFetcher, RowFetchContext, RowFetchOptions, RowFetchResult } from "./index";
import { decodeCursor, encodeCursor } from "../cursor";
import { toCompact, type RawMediaItem } from "../compact";

const ROW_ID = "upcomingForYou" as const satisfies RowKind;
const MAX_ITEMS = 60;

interface UpcomingEntry {
  item: RawMediaItem;
  season?: number;
  episode?: number;
  episodeTitle?: string;
  airsAt: string;
}

/**
 * Aggregate `calendar@v1.getUpcoming` scoped to shows the user is currently
 * watching. Pagination is `(tmdbId, airsAt)` composite ordering — multiple
 * episodes of the same show share `tmdbId` but differ on air time, so the
 * cursor must carry both halves to avoid skipping or duplicating episodes.
 *
 * Unique among rows: an empty fetch is meaningful info ("you're caught up"),
 * not absence of data. The client renders empty-state copy for this row when
 * `RowContentResponse.partial` is unset; degraded outcomes (timeout,
 * all_failed) are promoted to `partial: true` by `getRowContent` so the copy
 * stays suppressed during a calendar plugin outage.
 */
export const upcomingForYouFetcher: RowFetcher = {
  rowId: ROW_ID,
  title: "Upcoming for You",
  requires: ["calendar@v1"],

  // fallow-ignore-next-line complexity
  async fetch(ctx: RowFetchContext, opts: RowFetchOptions): Promise<RowFetchResult> {
    const after = readAfter(opts.cursor);
    const [result, inProgress] = await Promise.all([
      ctx.mediaService.getUpcomingFeed({ deadlineMs: ctx.deadlineMs }),
      ctx.dataloader.getInProgressSet(),
    ]);
    const filtered = (result.items as UpcomingEntry[]).filter((entry) =>
      filterByInProgress(entry, inProgress),
    );
    const entries = orderBy(filtered, [(e) => Date.parse(e.airsAt)], ["asc"]);
    const sliced = entries.filter((entry) => isAfter(entry, after)).slice(0, opts.limit);
    const items = sliced.map(mapToCompact);

    const lastEntry = last(sliced);
    const lastAnchor = lastEntry ? compositeId(lastEntry) : null;
    // No anchor available → end pagination cleanly. A synthetic "tv:0"
    // would let the cursor encode but produce a nonsensical starting point
    // for the next page, breaking the (tmdbId, airsAt) ordering.
    const cursor =
      !lastEntry || !lastAnchor || items.length < opts.limit || items.length >= MAX_ITEMS
        ? null
        : encodeCursor(ROW_ID, {
            v: 1,
            r: ROW_ID,
            a: lastAnchor,
            ts: Date.parse(lastEntry.airsAt),
          });
    return result.partial ? { items, cursor, partial: true } : { items, cursor };
  },

  async isEligible(_userId, loader) {
    // `calendarProgressCount > 0` from `candidateRows` is intentionally not
    // mirrored here: a user catching up mid-session is the row dropping to
    // `ok_empty`, not a 410 — plugin-presence governs eligibility.
    return loader.hasPlugin("calendar@v1");
  },
};

function readAfter(
  cursor: string | null,
): { tmdbId: string; mediaType: "movie" | "tv"; airsAt: number } | null {
  if (!cursor) return null;
  const decoded = decodeCursor(ROW_ID, cursor);
  const idx = decoded.a.indexOf(":");
  if (idx <= 0) return null;
  return {
    mediaType: decoded.a.slice(0, idx) as "movie" | "tv",
    tmdbId: decoded.a.slice(idx + 1),
    airsAt: decoded.ts,
  };
}

function filterByInProgress(entry: UpcomingEntry, inProgress: Set<string>): boolean {
  const id = compositeId(entry);
  if (!id) return false;
  return inProgress.has(id);
}

function isAfter(
  entry: UpcomingEntry,
  after: { tmdbId: string; mediaType: "movie" | "tv"; airsAt: number } | null,
): boolean {
  if (!after) return true;
  const ts = Date.parse(entry.airsAt);
  if (ts > after.airsAt) return true;
  if (ts < after.airsAt) return false;
  const id = compositeId(entry);
  return id !== null && id > `${after.mediaType}:${after.tmdbId}`;
}

function compositeId(entry: UpcomingEntry): string | null {
  const item = entry.item;
  if (!item) return null;
  const tmdbId = item.ids?.tmdb_id ?? null;
  if (!tmdbId) return null;
  return `${item.type}:${tmdbId}`;
}

function mapToCompact(entry: UpcomingEntry): CompactMediaItem {
  const extras: Partial<CompactMediaItem> = {};
  if (typeof entry.season === "number" && typeof entry.episode === "number") {
    extras.episode = {
      season: entry.season,
      episode: entry.episode,
      airsAt: Date.parse(entry.airsAt),
      ...(entry.episodeTitle ? { name: entry.episodeTitle } : {}),
    };
  }
  return toCompact(entry.item, extras);
}
