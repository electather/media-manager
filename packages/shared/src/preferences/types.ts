import type { Confidence, FeedbackAction, NoteSentiment, ProfileMediaType } from "./enums";

export type WeightMap = Record<string, number>;

export interface ProfileFeatures {
  genres: WeightMap;
  keywords: WeightMap;
  people: WeightMap;
  decades: WeightMap;
  runtimes: WeightMap;
  languages: WeightMap;
}

/** Public shape of a preference profile returned by the API. */
export interface PreferenceProfile {
  userId: string;
  mediaType: ProfileMediaType;
  features: ProfileFeatures;
  sampleSize: number;
  confidence: Confidence;
  lastRebuiltAt: number;
  lastUpdatedAt: number;
  embedding?: number[];
}

export interface FeedbackRecord {
  id: string;
  userId: string;
  tmdbId: string;
  mediaType: "movie" | "tv";
  action: FeedbackAction;
  rating: number | null;
  note: string | null;
  noteSentiment: NoteSentiment | null;
  noteKeywords: string[] | null;
  createdAt: number;
}

export interface RebuildResult {
  userId: string;
  mediaType: ProfileMediaType;
  sampleSize: number;
  confidence: Confidence;
}

export interface UpdateResult {
  userId: string;
  applied: number;
}
