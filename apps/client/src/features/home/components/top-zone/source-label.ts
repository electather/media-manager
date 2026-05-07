import * as m from "@/paraglide/messages";
import type { RowKind } from "@ent-mcp/shared/home";

/**
 * Maps the active hero slide's `RowKind` to the existing Paraglide row-header
 * message key. The hero mixer only emits four sources today
 * (`continueWatching`, `recommendedForYou`, `trendingNow`, `newReleases`);
 * the remaining `RowKind` members map to the closest semantic header so the
 * record stays exhaustive — adding a new `RowKind` upstream surfaces a type
 * error here.
 */
const LABELS: Record<RowKind, () => string> = {
  continueWatching: m.home_row_continueWatching_header,
  recommendedForYou: m.home_row_recommendedForYou_header,
  trendingNow: m.home_row_trendingNow_header,
  newReleases: m.home_row_newReleases_header,
  // Hero mixer never emits these RowKinds (`yourWatchlist`,
  // `becauseYouWatched`, `upcomingForYou`) — arms kept for exhaustiveness
  // only, so the closest semantic header is fine. Add dedicated copy if
  // the mixer ever starts surfacing them.
  yourWatchlist: m.home_row_continueWatching_header,
  becauseYouWatched: m.home_row_recommendedForYou_header,
  upcomingForYou: m.home_row_newReleases_header,
};

export function sourceLabel(source: RowKind): string {
  return LABELS[source]();
}
