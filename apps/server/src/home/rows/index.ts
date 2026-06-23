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
 * Registry of row pipelines. Add new row: drop file in home/rows/<slug>.ts (export default provider), register here, add test.
 * ROW_ORDER pins layout sequence for HomeLayoutResponse.rows; unlisted rows (e.g. similarTo) are composeRow-reachable but hidden.
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
