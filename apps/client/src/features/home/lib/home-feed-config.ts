import * as m from "@/paraglide/messages";
import { MATCH_REASON_KEYS, type MatchReasonKey, type RowKind } from "@nama/shared/home";
import type { RowAspect, RowData } from "./types";

/**
 * Initial vertical-virtualization estimate per home row; `measureElement` refines
 * after first paint. The literals below: 80 section head + card (180 for 16/9
 * backdrops, 300 for 2/3 posters) + 48 per-card meta strip + 40 `mb-8` margin.
 */
export function estimateHomeRowHeight(row: RowData): number {
  const card = row.defaultAspect === "16/9" ? 180 : 300;
  return 80 + card + 48 + 40;
}

/** Drives card image ratio for each row. Not present in the wire format. */
export const ROW_ASPECT: Record<RowKind, RowAspect> = {
  continueWatching: "16/9",
  upcomingForYou: "16/9",
  recommendedForYou: "2/3",
  becauseYouWatched: "2/3",
  trendingNow: "2/3",
  newReleases: "2/3",
  yourWatchlist: "2/3",
  similarTo: "2/3",
};

/** Row header and optional subtitle copy. Values are i18n message keys resolved via `m.<key>()`. */
export const ROW_COPY: Record<RowKind, { headerKey: keyof typeof m; eyebrowKey?: keyof typeof m }> =
  {
    continueWatching: {
      headerKey: "home_row_continueWatching_header",
      eyebrowKey: "home_row_continueWatching_eyebrow",
    },
    recommendedForYou: {
      headerKey: "home_row_recommendedForYou_header",
      eyebrowKey: "home_row_recommendedForYou_eyebrow",
    },
    trendingNow: {
      headerKey: "home_row_trendingNow_header",
      eyebrowKey: "home_row_trendingNow_eyebrow",
    },
    newReleases: {
      headerKey: "home_row_newReleases_header",
      eyebrowKey: "home_row_newReleases_eyebrow",
    },
    becauseYouWatched: {
      headerKey: "home_row_becauseYouWatched_header",
      eyebrowKey: "home_row_becauseYouWatched_eyebrow",
    },
    upcomingForYou: {
      headerKey: "home_row_upcomingForYou_header",
      eyebrowKey: "home_row_upcomingForYou_eyebrow",
    },
    yourWatchlist: {
      headerKey: "home_row_yourWatchlist_header",
      eyebrowKey: "home_row_yourWatchlist_eyebrow",
    },
    similarTo: {
      headerKey: "media_detail_section_related",
    },
  };

/**
 * Match-reason chip copy. Resolved through the keyed `home_match_reason` ICU
 * variant (selector `reason`); every reason rides one message, with the
 * per-reason placeholders (`n` / `genre` / `seedTitle`) carried as inputs.
 */
export const MATCH_REASON_COPY: Record<MatchReasonKey, (params: Record<string, string>) => string> =
  Object.fromEntries(
    MATCH_REASON_KEYS.map(
      (reason): [MatchReasonKey, (params: Record<string, string>) => string] => [
        reason,
        (p: Record<string, string>) =>
          m.home_match_reason({
            reason,
            n: p.n ?? "",
            genre: p.genre ?? "",
            seedTitle: p.seedTitle ?? "",
          }),
      ],
    ),
  ) as Record<MatchReasonKey, (params: Record<string, string>) => string>;
