import becauseYouWatched from "./because-you-watched";
import continueWatchingActive from "./continue-watching-active";
import continueWatchingNext from "./continue-watching-next";
import newReleases from "./new-releases";
import recommendedForYouMovies from "./recommended-for-you-movies";
import recommendedForYouTv from "./recommended-for-you-tv";
import similarTo from "./similar-to";
import trendingNow from "./trending-now";
import upcomingForYou from "./upcoming-for-you";
import yourWatchlist from "./your-watchlist";
import type { RowProvider } from "../internal/types";

/**
 * Registry of every row pipeline. Adding a new row means:
 *   1. Drop a file in `home/rows/<slug>.ts` with `export default provider`
 *   2. Register it here
 *   3. Place a sibling test in `home/rows/__tests__/<slug>.test.ts`
 *
 * `ROW_ORDER` pins the static layout sequence the orchestrator emits in
 * `HomeLayoutResponse.rows`. Rows not listed in `ROW_ORDER` (e.g. `similarTo`)
 * are still reachable via `composeRow` but never appear in the home layout.
 */
export const ROW_PROVIDERS: Record<string, RowProvider> = {
  "continueWatching-active": continueWatchingActive,
  "continueWatching-next": continueWatchingNext,
  becauseYouWatched,
  "recommendedForYou-tv": recommendedForYouTv,
  "recommendedForYou-movies": recommendedForYouMovies,
  yourWatchlist,
  upcomingForYou,
  trendingNow,
  newReleases,
  similarTo,
};

export const ROW_ORDER: string[] = [
  "continueWatching-active",
  "continueWatching-next",
  "becauseYouWatched",
  "recommendedForYou-tv",
  "recommendedForYou-movies",
  "yourWatchlist",
  "upcomingForYou",
  "trendingNow",
  "newReleases",
];
