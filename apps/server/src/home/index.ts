/**
 * Public barrel for `home/`. Boundaries test asserts re-exports come only
 * from `./service`, `./events`, `./errors`, and `./jobs`. `./repo`,
 * `./internal/**`, and individual files under `./jobs/` and `./rows/` are
 * deliberately not re-exported — external callers route through the
 * orchestrator surface below.
 */
export {
  buildContext,
  composeDetails,
  composeLayout,
  composeRow,
  composeSeasonAvailability,
  type ComposeOptions,
} from "./service";
export { HOME_EVENTS } from "./events";
export { HomeServiceError } from "./errors";
export { registerJobs } from "./jobs";
