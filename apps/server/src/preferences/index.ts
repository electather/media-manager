/** Public barrel: re-exports only from ./service, ./events, ./errors, ./types, ./jobs. Blocks ./repo/**, ./internal/**, individual ./jobs/<x>.ts. */
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
