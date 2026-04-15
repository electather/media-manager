export interface ScoreMap {
  [key: string]: number;
}

export interface PreferenceProfile {
  userId: string;
  genreScores: ScoreMap;
  themeScores: ScoreMap;
  keywordScores: ScoreMap;
  directorScores: ScoreMap;
  actorScores: ScoreMap;
  lastComputedAt: Date;
}

export interface FeedbackSignals {
  genres: string[];
  keywords: string[];
  directors: string[];
  actors: string[];
  themes: string[];
}
