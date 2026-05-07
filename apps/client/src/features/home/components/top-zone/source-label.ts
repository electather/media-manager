import * as m from "@/paraglide/messages";
import type { RowKind } from "@ent-mcp/shared/home";

/**
 * Maps the active hero slide's `RowKind` to the existing Paraglide row-header
 * message key. The hero mixer only emits four sources today
 * (`continueWatching`, `recommendedForYou`, `trendingNow`, `newReleases`);
 * the remaining `RowKind` members are mapped to their closest semantic header
 * so the switch stays exhaustive and adding a new `RowKind` upstream surfaces
 * a type error here.
 */
export function sourceLabel(source: RowKind): string {
  switch (source) {
    case "continueWatching":
      return m.home_row_continueWatching_header();
    case "recommendedForYou":
    case "becauseYouWatched":
      return m.home_row_recommendedForYou_header();
    case "trendingNow":
      return m.home_row_trendingNow_header();
    case "newReleases":
    case "upcomingForYou":
      return m.home_row_newReleases_header();
    case "yourWatchlist":
      return m.home_row_continueWatching_header();
  }
}
