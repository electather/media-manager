export const PROFILE_MEDIA_TYPES = ["movie", "tv", "combined"] as const;
export const CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;
export const FEEDBACK_ACTIONS = ["like", "dislike", "rate", "note"] as const;
export const NOTE_SENTIMENTS = ["positive", "negative", "neutral"] as const;

export const FEATURE_CATEGORIES = [
  "genres",
  "keywords",
  "people",
  "decades",
  "runtimes",
  "languages",
] as const;

export type ProfileMediaType = (typeof PROFILE_MEDIA_TYPES)[number];
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];
export type FeedbackAction = (typeof FEEDBACK_ACTIONS)[number];
export type NoteSentiment = (typeof NOTE_SENTIMENTS)[number];
export type FeatureCategory = (typeof FEATURE_CATEGORIES)[number];
