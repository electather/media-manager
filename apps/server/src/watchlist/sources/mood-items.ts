import type { ActiveRow } from "@ent-mcp/shared/media";
import { keyToId, WATCHLIST_LIST_MAX_LIMIT, type MoodId } from "@ent-mcp/shared/watchlist";
import {
  listActiveRowsKeyset,
  type Cursor,
  type MediaSource,
  type PipelineConfig,
  type RawPageToken,
  type SourceContext,
} from "../../media";
import { derive as deriveMoods } from "../moods/derive";
import { decodeKeyset, rawToken } from "./keyset";
import { loadRowMetadata } from "./metadata";

/** Request params for the watchlist `mood-items` source (`/moods/:moodId/items`). */
export interface MoodParams {
  moodId: MoodId;
  limit: number;
}

/**
 * Multiply the page size by this when scanning so a single keyset window can
 * still yield a full page after the mood predicate prunes most rows.
 */
const OVERSHOOT_FACTOR = 3;
/** Consecutive windows that add no matches before the scan gives up. */
const MAX_EMPTY_HOPS = 2;
/**
 * Total hop ceiling. Empty/sparse windows that don't advance the accumulator
 * burn one hop each; this caps how many we'll spend before giving up so a
 * pathologically large + pathologically sparse mood doesn't pin a request.
 */
const MAX_MOOD_HOPS = 20;

/**
 * The watchlist `mood-items` `MediaSource` (design §S.3 / consolidation §H).
 * Mood is a watchlist-product predicate media must not derive, so the source
 * applies it inside `fetchRawSet` (V.RG1): it scans keyset windows, keeps the
 * rows whose canonical genres derive the requested mood, and accumulates a full
 * page across windows (with an empty-streak budget so a sparse mood still fills
 * a page). It supplies ONLY the matched raw rows + a `stages` declaration; the
 * media pipeline (`listRows`) owns enrich / sort / paginate / cursor (V.MC1).
 * `filter: "preapplied"` is declarative — it tells the pipeline the predicate
 * already ran here so the filter stage must NOT re-derive it (the watchlist
 * mood predicate cannot leak into media per V.WL3).
 */
export const moodItemsSource: MediaSource<MoodParams> = {
  sourceId: "watchlist.mood-items",
  fetchRawSet: fetchMoodRawSet,
  stages: { filter: "preapplied", sort: "recentDesc", cursorMode: "keyset" },
};

/** Build the pipeline config for a `/moods/:moodId/items` read. */
export function moodItemsCfg(
  params: MoodParams,
  cursor: Cursor | null,
): PipelineConfig<MoodParams> {
  return { params, cursor, limit: params.limit, filter: "preapplied" };
}

/**
 * Scan keyset windows applying the mood predicate, accumulating up to `limit`
 * matched rows. Underfilled windows that still add a match reset the empty
 * streak so a deep-but-progressing scan keeps going; a window that adds nothing
 * burns one streak slot. The accumulated rows are already `addedAt` DESC (keyset
 * order across windows), so the pipeline's `recentDesc` sort preserves them.
 *
 * `nextRaw` is the hop token the pipeline mints the next cursor from. It is
 * omitted (→ `cursor:null`, #500 / V.PG1) when the scan is exhausted or the
 * empty-streak budget exits without collecting anything, so the client never
 * shows a phantom load-more.
 */
// fallow-ignore-next-line complexity
async function fetchMoodRawSet(
  ctx: SourceContext,
  params: MoodParams,
  cursor: Cursor | null,
): Promise<{ rows: ActiveRow[]; partial: boolean; nextRaw?: RawPageToken }> {
  const { moodId, limit } = params;
  const fetchSize = Math.min(limit * OVERSHOOT_FACTOR, WATCHLIST_LIST_MAX_LIMIT);
  let scanCursor = decodeKeyset(cursor);
  const collected: ActiveRow[] = [];
  let partial = false;
  let nextRaw: RawPageToken | undefined;
  let emptyStreak = 0;

  for (let hop = 0; hop < MAX_MOOD_HOPS; hop++) {
    const rows = await listActiveRowsKeyset(ctx.userId, {
      limit: fetchSize,
      ...(scanCursor ? { cursor: scanCursor } : {}),
    });
    if (rows.length === 0) break;

    const matched = await filterRowsByMood(rows, ctx, moodId);
    if (matched.partial) partial = true;

    const need = limit - collected.length;
    if (matched.rows.length === 0) {
      emptyStreak++;
    } else {
      emptyStreak = 0;
      collected.push(...matched.rows.slice(0, need));
    }

    const lastScanned = rows[rows.length - 1]!;
    const exhausted = rows.length < fetchSize;
    if (collected.length >= limit) {
      const last = collected[collected.length - 1] ?? lastScanned;
      // Exhausted and this window did not overflow `need` → nothing left.
      nextRaw = exhausted && matched.rows.length <= need ? undefined : rawToken(last);
      break;
    }
    if (exhausted) break;
    if (emptyStreak > MAX_EMPTY_HOPS) {
      nextRaw = collected.length > 0 ? rawToken(lastScanned) : undefined;
      break;
    }
    scanCursor = { addedAt: lastScanned.addedAt, id: lastScanned.id };
  }

  return { rows: collected, partial, ...(nextRaw !== undefined ? { nextRaw } : {}) };
}

/**
 * Load canonical metadata for `rows` and keep the ones whose genres derive the
 * requested mood (the pure `deriveMoods` predicate, V.WL3). A failed metadata
 * batch warns and folds into `partial` rather than throwing.
 */
async function filterRowsByMood(
  rows: ActiveRow[],
  ctx: SourceContext,
  mood: MoodId,
): Promise<{ rows: ActiveRow[]; partial: boolean }> {
  const { map, partial } = await loadRowMetadata(ctx, rows, "mood-items");
  const kept = rows.filter((r) =>
    deriveMoods(map[keyToId({ tmdbId: r.tmdbId, mediaType: r.mediaType })]).includes(mood),
  );
  return { rows: kept, partial };
}
