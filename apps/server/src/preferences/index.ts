/**
 * Public barrel for `preferences/`. Boundaries test asserts re-exports come
 * only from `./service`, `./events`, `./errors`, `./types`, and `./jobs`.
 * `./repo/**`, `./internal/**`, and individual job-handler files in
 * `./jobs/<x>.ts` are deliberately not re-exported — external callers go
 * through the service.
 */
export {
  PreferencesService,
  getPreferencesService,
  resetPreferencesServiceForTest,
  type FeatureCacheMetrics,
  type RankOptions,
  type RebuildRow,
  type RecordFeedbackInput,
  type StoredPreferenceProfile,
  type WriteProfileOptions,
} from "./service";
export { PREFERENCES_EVENTS } from "./events";
export { PreferencesError, JobNotRegisteredError, JobNotTriggerableError } from "./errors";
export type {
  CandidateFeatures,
  CommentSignal,
  FeatureContribution,
  HistorySignal,
  MediaItemFields,
  PreferenceDataProvider,
  RankedCandidate,
  RatingSignal,
  RawMediaItem,
  UserItemFeedback,
  WatchlistSignal,
} from "./types";
export { registerJobs, type RegisterJobsOptions } from "./jobs";
