import * as m from "@/paraglide/messages";
import type { RowKind } from "@ent-mcp/shared/home";
import type { MatchReasonKey } from "./types";

/** Drives card image ratio for each row. Not present in the wire format. */
export const ROW_ASPECT: Record<RowKind, "16/9" | "2/3"> = {
  continueWatching: "16/9",
  upcomingForYou: "16/9",
  recommendedForYou: "2/3",
  becauseYouWatched: "2/3",
  trendingNow: "2/3",
  newReleases: "2/3",
  yourWatchlist: "2/3",
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
  };

/** Match-reason chip copy. Parameterised via Paraglide ICU placeholders. */
export const MATCH_REASON_COPY: Record<MatchReasonKey, (params: Record<string, string>) => string> =
  {
    matches_recent_picks: (p) => m.home_match_reason_matches_recent_picks({ n: p.n ?? "" }),
    from_genre_you_love: (p) => m.home_match_reason_from_genre_you_love({ genre: p.genre ?? "" }),
    similar_to_seed: (p) => m.home_match_reason_similar_to_seed({ seedTitle: p.seedTitle ?? "" }),
    because_in_watchlist: (_p) => m.home_match_reason_because_in_watchlist(),
    continuing_series: (_p) => m.home_match_reason_continuing_series(),
    upcoming_release: (_p) => m.home_match_reason_upcoming_release(),
    recently_added: (_p) => m.home_match_reason_recently_added(),
    highly_rated: (_p) => m.home_match_reason_highly_rated(),
    from_active_series: (_p) => m.home_match_reason_from_active_series(),
    finishing_soon: (_p) => m.home_match_reason_finishing_soon(),
  };
