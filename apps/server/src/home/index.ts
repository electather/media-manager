/**
 * Public barrel for `home/`. Boundaries test asserts only `./service`, `./events`,
 * `./errors`, `./jobs` are re-exported; `./internal/`, `./layout-cache`, and individual
 * `./jobs/` and `./rows/` files are deliberately private.
 */
export {
  buildContext,
  composeDetails,
  composeLayout,
  composeRow,
  composeSeasonAvailability,
  homeMediaSources,
  makeRecommendationsMemo,
  type ComposeOptions,
} from "./service";
export { HOME_EVENTS } from "./events";
export { HomeServiceError } from "./errors";
export { registerJobs } from "./jobs";
