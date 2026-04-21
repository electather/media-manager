import { feedbackLog } from "./feedback-log";
import { SCORERS, isDictScorer } from "./features";
import { profileStorage } from "./storage";
import { normalizeProfile } from "./scoring";
import type { PreferenceDataProvider } from "./provider";
import { classifySentiment } from "./sentiment";
import {
  deriveConfidence,
  emptyFeatures,
  type CandidateFeatures,
  type FeatureCategory,
  type FeedbackRecord,
  type PreferenceProfile,
  type ProfileFeatures,
  type ProfileMediaType,
  type RebuildResult,
} from "./types";

const HALF_LIFE_MS = 2 * 365 * 24 * 60 * 60 * 1000;
const DECAY_CATEGORIES = new Set<FeatureCategory>(["genres", "keywords"]);

const SIGNAL_WEIGHTS = {
  rateHigh: 1.0,
  rateMid: 0,
  rateLow: -0.8,
  like: 0.8,
  dislike: -1.0,
  notePositive: 0.6,
  noteNegative: -0.6,
  noteNeutral: 0,
  completed: 0.5,
  watchlist: 0.3,
  commentPositive: 0.5,
  commentNegative: -0.5,
  commentNeutral: 0,
} as const;

const TOP_K: Record<FeatureCategory, number> = {
  genres: 50,
  keywords: 200,
  people: 100,
  decades: 10,
  runtimes: 4,
  languages: 20,
};

const NOTE_KEYWORD_BOOST = 0.3;

export interface RebuildDeps {
  provider: PreferenceDataProvider;
  abortSignal?: AbortSignal;
}

export async function rebuildProfile(
  deps: RebuildDeps,
  userId: string,
  mediaType: ProfileMediaType,
  now: number = Date.now(),
): Promise<RebuildResult> {
  deps.abortSignal?.throwIfAborted();
  const contributions = await collectContributions(deps, userId, mediaType);
  const features = aggregate(contributions, now);
  const pruned = topKPrune(features);
  const normalized = normalizeProfile(pruned);

  const profile: PreferenceProfile = {
    userId,
    mediaType,
    features: normalized,
    sampleSize: contributions.size,
    confidence: deriveConfidence(contributions.size),
    lastRebuiltAt: now,
    lastUpdatedAt: now,
  };
  await profileStorage.write(profile);
  return {
    userId,
    mediaType,
    sampleSize: profile.sampleSize,
    confidence: profile.confidence,
  };
}

interface ItemContribution {
  candidate: CandidateFeatures;
  weight: number;
  timestamp: number;
  noteKeywords: string[];
}

/**
 * Reduces every feedback event, rating, and history entry for the user to a
 * single per-item contribution (weight + timestamp). Events for items outside
 * the requested `mediaType` partition are filtered out up front unless we're
 * building the combined profile.
 */
async function collectContributions(
  deps: RebuildDeps,
  userId: string,
  mediaType: ProfileMediaType,
): Promise<Map<string, ItemContribution>> {
  const [feedbackRows, history, ratings, watchlist, comments] = await Promise.all([
    feedbackLog.readAllForUser(userId),
    deps.provider.getHistory(userId),
    deps.provider.getAllRatings(userId),
    deps.provider.getWatchlist(userId),
    deps.provider.getComments(userId),
  ]);

  const perItem = new Map<string, PerItemSignals>();
  for (const record of feedbackRows) {
    if (!includesMediaType(record.mediaType, mediaType)) continue;
    mergeFeedback(perItem, record);
  }
  for (const rating of ratings) {
    if (!includesMediaType(rating.mediaType, mediaType)) continue;
    mergeRating(perItem, rating);
  }
  for (const entry of history) {
    if (!includesMediaType(entry.mediaType, mediaType)) continue;
    mergeHistory(perItem, entry);
  }
  for (const entry of watchlist) {
    if (!includesMediaType(entry.mediaType, mediaType)) continue;
    mergeWatchlist(perItem, entry);
  }
  for (const entry of comments) {
    if (!includesMediaType(entry.mediaType, mediaType)) continue;
    mergeComment(perItem, entry);
  }

  const candidates = [...perItem.entries()].filter(([, s]) => resolveItemWeight(s) !== 0);

  const CONCURRENCY = 10;
  const output = new Map<string, ItemContribution>();
  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    deps.abortSignal?.throwIfAborted();
    const batch = candidates.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async ([key, signals]) => {
        const weight = resolveItemWeight(signals);
        const candidate = await deps.provider.getItemFeatures(
          userId,
          signals.tmdbId,
          signals.mediaType,
        );
        return { key, signals, weight, candidate };
      }),
    );
    for (const { key, signals, weight, candidate } of results) {
      if (!candidate) continue;
      output.set(key, {
        candidate,
        weight,
        timestamp: signals.latestAt,
        noteKeywords: signals.noteKeywords,
      });
    }
  }
  return output;
}

interface PerItemSignals {
  tmdbId: string;
  mediaType: "movie" | "tv";
  latestAt: number;
  rate?: { rating: number; at: number };
  like?: { at: number };
  dislike?: { at: number };
  note?: { sentiment: "positive" | "negative" | "neutral"; at: number };
  completed?: { at: number };
  watchlisted?: { at: number };
  comment?: { sentiment: "positive" | "negative" | "neutral"; at: number };
  noteKeywords: string[];
}

function signalsFor(
  perItem: Map<string, PerItemSignals>,
  tmdbId: string,
  mediaType: "movie" | "tv",
  at: number,
): PerItemSignals {
  const key = `${mediaType}:${tmdbId}`;
  const existing = perItem.get(key);
  if (existing) {
    if (at > existing.latestAt) existing.latestAt = at;
    return existing;
  }
  const created: PerItemSignals = { tmdbId, mediaType, latestAt: at, noteKeywords: [] };
  perItem.set(key, created);
  return created;
}

function mergeFeedback(perItem: Map<string, PerItemSignals>, record: FeedbackRecord): void {
  const entry = signalsFor(perItem, record.tmdbId, record.mediaType, record.createdAt);
  switch (record.action) {
    case "rate":
      if (record.rating !== null && (!entry.rate || record.createdAt > entry.rate.at)) {
        entry.rate = { rating: record.rating, at: record.createdAt };
      }
      break;
    case "like":
      if (!entry.like || record.createdAt > entry.like.at) {
        entry.like = { at: record.createdAt };
      }
      break;
    case "dislike":
      if (!entry.dislike || record.createdAt > entry.dislike.at) {
        entry.dislike = { at: record.createdAt };
      }
      break;
    case "note": {
      const sentiment = record.noteSentiment ?? "neutral";
      if (!entry.note || record.createdAt > entry.note.at) {
        entry.note = { sentiment, at: record.createdAt };
      }
      for (const keyword of record.noteKeywords ?? []) {
        if (!entry.noteKeywords.includes(keyword)) entry.noteKeywords.push(keyword);
      }
      break;
    }
  }
}

function mergeRating(
  perItem: Map<string, PerItemSignals>,
  rating: { tmdbId: string; mediaType: "movie" | "tv"; rating: number; ratedAt: number },
): void {
  const entry = signalsFor(perItem, rating.tmdbId, rating.mediaType, rating.ratedAt);
  if (!entry.rate || rating.ratedAt > entry.rate.at) {
    entry.rate = { rating: rating.rating, at: rating.ratedAt };
  }
}

function mergeHistory(
  perItem: Map<string, PerItemSignals>,
  entry: { tmdbId: string; mediaType: "movie" | "tv"; watchedAt: number; progress: number | null },
): void {
  const isCompleted = entry.progress === null || entry.progress >= 0.8;
  if (!isCompleted) return;
  const signals = signalsFor(perItem, entry.tmdbId, entry.mediaType, entry.watchedAt);
  if (!signals.completed || entry.watchedAt > signals.completed.at) {
    signals.completed = { at: entry.watchedAt };
  }
}

function mergeWatchlist(
  perItem: Map<string, PerItemSignals>,
  entry: { tmdbId: string; mediaType: "movie" | "tv"; addedAt: number },
): void {
  const signals = signalsFor(perItem, entry.tmdbId, entry.mediaType, entry.addedAt);
  if (!signals.watchlisted || entry.addedAt > signals.watchlisted.at) {
    signals.watchlisted = { at: entry.addedAt };
  }
}

function mergeComment(
  perItem: Map<string, PerItemSignals>,
  entry: { tmdbId: string; mediaType: "movie" | "tv"; text: string; createdAt: number },
): void {
  const sentiment = classifySentiment(entry.text);
  const signals = signalsFor(perItem, entry.tmdbId, entry.mediaType, entry.createdAt);
  if (!signals.comment || entry.createdAt > signals.comment.at) {
    signals.comment = { sentiment, at: entry.createdAt };
  }
}

/** Combines the per-source weights into a single signed weight per item. */
function resolveItemWeight(signals: PerItemSignals): number {
  let total = 0;
  if (signals.rate) total += rateBucketWeight(signals.rate.rating);
  if (signals.like) total += SIGNAL_WEIGHTS.like;
  if (signals.dislike) total += SIGNAL_WEIGHTS.dislike;
  if (signals.note) total += noteWeight(signals.note.sentiment);
  if (signals.completed) total += SIGNAL_WEIGHTS.completed;
  if (signals.watchlisted) total += SIGNAL_WEIGHTS.watchlist;
  if (signals.comment) total += commentWeight(signals.comment.sentiment);
  return total;
}

function rateBucketWeight(rating: number): number {
  if (rating >= 8) return SIGNAL_WEIGHTS.rateHigh;
  if (rating <= 3) return SIGNAL_WEIGHTS.rateLow;
  return SIGNAL_WEIGHTS.rateMid;
}

function noteWeight(sentiment: "positive" | "negative" | "neutral"): number {
  if (sentiment === "positive") return SIGNAL_WEIGHTS.notePositive;
  if (sentiment === "negative") return SIGNAL_WEIGHTS.noteNegative;
  return SIGNAL_WEIGHTS.noteNeutral;
}

function commentWeight(sentiment: "positive" | "negative" | "neutral"): number {
  if (sentiment === "positive") return SIGNAL_WEIGHTS.commentPositive;
  if (sentiment === "negative") return SIGNAL_WEIGHTS.commentNegative;
  return SIGNAL_WEIGHTS.commentNeutral;
}

function includesMediaType(itemType: "movie" | "tv", partition: ProfileMediaType): boolean {
  if (partition === "combined") return true;
  return itemType === partition;
}

/**
 * Folds the per-item contributions into category dicts, applying the recency
 * decay for genres and keywords.
 */
function aggregate(contributions: Map<string, ItemContribution>, now: number): ProfileFeatures {
  const features = emptyFeatures();
  for (const contribution of contributions.values()) {
    const decay = recencyMultiplier(now, contribution.timestamp);
    for (const scorer of SCORERS) {
      if (!isDictScorer(scorer)) continue;
      const dict = scorer.extract(contribution.candidate);
      const shouldDecay = DECAY_CATEGORIES.has(scorer.id);
      const weight = contribution.weight * (shouldDecay ? decay : 1);
      for (const [feature, rawValue] of Object.entries(dict)) {
        const value = rawValue * weight;
        if (value === 0) continue;
        const bucket = features[scorer.id];
        bucket[feature] = (bucket[feature] ?? 0) + value;
      }
    }
    for (const keyword of contribution.noteKeywords) {
      const value =
        NOTE_KEYWORD_BOOST * contribution.weight * recencyMultiplier(now, contribution.timestamp);
      features.keywords[keyword] = (features.keywords[keyword] ?? 0) + value;
    }
  }
  return features;
}

function recencyMultiplier(now: number, timestamp: number): number {
  const months = Math.max(0, (now - timestamp) / (30 * 24 * 60 * 60 * 1000));
  return Math.pow(0.5, (months * 30 * 24 * 60 * 60 * 1000) / HALF_LIFE_MS);
}

function topKPrune(features: ProfileFeatures): ProfileFeatures {
  const out = emptyFeatures();
  for (const scorer of SCORERS) {
    out[scorer.id] = pruneMap(features[scorer.id], TOP_K[scorer.id]);
  }
  return out;
}

function pruneMap(map: Record<string, number>, k: number): Record<string, number> {
  const entries = Object.entries(map);
  if (entries.length <= k) return { ...map };
  entries.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const kept: Record<string, number> = {};
  for (let i = 0; i < k; i += 1) {
    const [key, value] = entries[i]!;
    kept[key] = value;
  }
  return kept;
}

export { SIGNAL_WEIGHTS, TOP_K, HALF_LIFE_MS, recencyMultiplier };
