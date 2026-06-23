import { consola } from "consola";
import { orderBy } from "es-toolkit/array";
import type {
  FeatureCategory,
  FeedbackRecord,
  PreferenceProfile,
  ProfileFeatures,
  ProfileMediaType,
  RebuildResult,
} from "@nama/shared/preferences";
import { feedbackLog } from "./feedback-log";
import { SCORERS, isDictScorer, type FeatureScorer } from "./features";
import { profileStorage } from "./profile-storage";
import { normalizeProfile } from "./scoring";
import { classifySentiment } from "./sentiment";
import { deriveConfidence, emptyFeatures } from "./constants";
import type { CandidateFeatures, PreferenceDataProvider } from "../types";

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
  /** Wall-clock deadline (ms-epoch) for collectContributions plugin dispatch. Items past deadline dropped without provider call so cold catalog can't overrun job timeout. `undefined` disables bound (for incremental updates, short + debounced). */
  deadlineMs?: number;
}

function topEntries(dict: Record<string, number>, n: number): string[] {
  return orderBy(Object.entries(dict), [([, v]) => v], ["desc"])
    .slice(0, n)
    .map(([k]) => k);
}

export async function rebuildProfile(
  deps: RebuildDeps,
  userId: string,
  mediaType: ProfileMediaType,
  now: number = Date.now(),
): Promise<RebuildResult> {
  consola.debug("[preferences:rebuild] start", { userId, mediaType, now });

  deps.abortSignal?.throwIfAborted();
  const contributions = await collectContributions(deps, userId, mediaType);

  const features = aggregate(contributions, now);
  const pruned = topKPrune(features);
  consola.debug("[preferences:rebuild] pruned", {
    userId,
    mediaType,
    counts: Object.fromEntries(
      Object.entries(pruned).map(([cat, dict]) => [cat, Object.keys(dict).length]),
    ),
  });

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
  await profileStorage.write(profile, { bumpVersion: true });
  consola.debug("[preferences:rebuild] done", {
    userId,
    mediaType,
    sampleSize: profile.sampleSize,
    confidence: profile.confidence,
    topGenres: topEntries(normalized.genres, 3),
    topKeywords: topEntries(normalized.keywords, 5),
  });
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

// Reduces feedback events, ratings, history entries to single per-item contribution (weight + timestamp). Filters out items outside requested mediaType partition upfront unless building combined profile.
async function collectContributions(
  deps: RebuildDeps,
  userId: string,
  mediaType: ProfileMediaType,
): Promise<Map<string, ItemContribution>> {
  const sources = await fetchAllSources(deps.provider, userId);
  logSources(userId, mediaType, sources);

  const perItem = buildPerItemSignals(sources, mediaType);
  const signalCounts = countSignals(perItem);

  const candidates = [...perItem.entries()].filter(([, s]) => resolveItemWeight(s) !== 0);
  const zeroWeightDropped = perItem.size - candidates.length;

  const output = await fetchFeaturesForCandidates(deps, userId, candidates);

  consola.debug("[preferences:rebuild] contributions", {
    userId,
    mediaType,
    signals: signalCounts,
    zeroWeightDropped,
    noFeaturesDropped: candidates.length - output.size,
    total: output.size,
  });
  return output;
}

interface AllSources {
  feedbackRows: Awaited<ReturnType<typeof feedbackLog.readAllForUser>>;
  history: Awaited<ReturnType<PreferenceDataProvider["getHistory"]>>;
  ratings: Awaited<ReturnType<PreferenceDataProvider["getAllRatings"]>>;
  watchlist: Awaited<ReturnType<PreferenceDataProvider["getWatchlist"]>>;
  comments: Awaited<ReturnType<PreferenceDataProvider["getComments"]>>;
}

async function fetchAllSources(
  provider: PreferenceDataProvider,
  userId: string,
): Promise<AllSources> {
  const [feedbackRows, history, ratings, watchlist, comments] = await Promise.all([
    feedbackLog.readAllForUser(userId),
    provider.getHistory(userId),
    provider.getAllRatings(userId),
    provider.getWatchlist(userId),
    provider.getComments(userId),
  ]);
  return { feedbackRows, history, ratings, watchlist, comments };
}

function logSources(userId: string, mediaType: ProfileMediaType, sources: AllSources): void {
  consola.debug("[preferences:rebuild] sources", {
    userId,
    mediaType,
    feedbackRows: sources.feedbackRows.length,
    history: sources.history.length,
    ratings: sources.ratings.length,
    watchlist: sources.watchlist.length,
    comments: sources.comments.length,
  });
}

// fallow-ignore-next-line complexity
function buildPerItemSignals(
  sources: AllSources,
  mediaType: ProfileMediaType,
): Map<string, PerItemSignals> {
  const perItem = new Map<string, PerItemSignals>();
  for (const record of sources.feedbackRows) {
    if (!includesMediaType(record.mediaType, mediaType)) continue;
    mergeFeedback(perItem, record);
  }
  for (const rating of sources.ratings) {
    if (!includesMediaType(rating.mediaType, mediaType)) continue;
    mergeRating(perItem, rating);
  }
  for (const entry of sources.history) {
    if (!includesMediaType(entry.mediaType, mediaType)) continue;
    mergeHistory(perItem, entry);
  }
  for (const entry of sources.watchlist) {
    if (!includesMediaType(entry.mediaType, mediaType)) continue;
    mergeWatchlist(perItem, entry);
  }
  for (const entry of sources.comments) {
    if (!includesMediaType(entry.mediaType, mediaType)) continue;
    mergeComment(perItem, entry);
  }
  return perItem;
}

type SignalCounts = ReturnType<typeof initSignalCounts>;

function initSignalCounts() {
  return {
    rateHigh: 0,
    rateMid: 0,
    rateLow: 0,
    like: 0,
    dislike: 0,
    note: 0,
    completed: 0,
    watchlist: 0,
    comment: 0,
  };
}

// fallow-ignore-next-line complexity
function tallySignals(counts: SignalCounts, s: PerItemSignals): void {
  if (s.rate) {
    const w = rateBucketWeight(s.rate.rating);
    if (w > 0) counts.rateHigh++;
    else if (w < 0) counts.rateLow++;
    else counts.rateMid++;
  }
  if (s.like) counts.like++;
  if (s.dislike) counts.dislike++;
  if (s.note) counts.note++;
  if (s.completed) counts.completed++;
  if (s.watchlisted) counts.watchlist++;
  if (s.comment) counts.comment++;
}

function countSignals(perItem: Map<string, PerItemSignals>): SignalCounts {
  const counts = initSignalCounts();
  for (const s of perItem.values()) tallySignals(counts, s);
  return counts;
}

// fallow-ignore-next-line complexity
async function fetchFeaturesForCandidates(
  deps: RebuildDeps,
  userId: string,
  candidates: [string, PerItemSignals][],
): Promise<Map<string, ItemContribution>> {
  const CONCURRENCY = 10;
  const output = new Map<string, ItemContribution>();
  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    deps.abortSignal?.throwIfAborted();
    if (deps.deadlineMs !== undefined && Date.now() > deps.deadlineMs) break;
    const batch = candidates.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(([key, signals]) => fetchOneCandidate(deps, userId, key, signals)),
    );
    for (const { key, signals, weight, candidate } of results) {
      if (!candidate) continue;
      output.set(key, {
        candidate,
        weight,
        timestamp: signals.latestAt,
        noteKeywords: [...signals.noteKeywords],
      });
    }
  }
  return output;
}

async function fetchOneCandidate(
  deps: RebuildDeps,
  userId: string,
  key: string,
  signals: PerItemSignals,
) {
  const weight = resolveItemWeight(signals);
  if (deps.deadlineMs !== undefined && Date.now() > deps.deadlineMs) {
    return { key, signals, weight, candidate: null };
  }
  const candidate = await deps.provider.getItemFeatures(userId, signals.tmdbId, signals.mediaType);
  return { key, signals, weight, candidate };
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
  noteKeywords: Set<string>;
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
  const created: PerItemSignals = { tmdbId, mediaType, latestAt: at, noteKeywords: new Set() };
  perItem.set(key, created);
  return created;
}

function isNewer(existing: { at: number } | undefined, at: number): boolean {
  return !existing || at > existing.at;
}

// fallow-ignore-next-line complexity
function mergeFeedback(perItem: Map<string, PerItemSignals>, record: FeedbackRecord): void {
  const entry = signalsFor(perItem, record.tmdbId, record.mediaType, record.createdAt);
  const at = record.createdAt;
  switch (record.action) {
    case "rate":
      if (record.rating !== null && isNewer(entry.rate, at)) {
        entry.rate = { rating: record.rating, at };
      }
      break;
    case "like":
      if (isNewer(entry.like, at)) entry.like = { at };
      break;
    case "dislike":
      if (isNewer(entry.dislike, at)) entry.dislike = { at };
      break;
    case "note": {
      const sentiment = record.noteSentiment ?? "neutral";
      if (isNewer(entry.note, at)) entry.note = { sentiment, at };
      for (const keyword of record.noteKeywords ?? []) {
        entry.noteKeywords.add(keyword);
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
  if (isNewer(entry.rate, rating.ratedAt)) {
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
  if (isNewer(signals.completed, entry.watchedAt)) signals.completed = { at: entry.watchedAt };
}

function mergeWatchlist(
  perItem: Map<string, PerItemSignals>,
  entry: { tmdbId: string; mediaType: "movie" | "tv"; addedAt: number },
): void {
  const signals = signalsFor(perItem, entry.tmdbId, entry.mediaType, entry.addedAt);
  if (isNewer(signals.watchlisted, entry.addedAt)) signals.watchlisted = { at: entry.addedAt };
}

function mergeComment(
  perItem: Map<string, PerItemSignals>,
  entry: { tmdbId: string; mediaType: "movie" | "tv"; text: string; createdAt: number },
): void {
  const sentiment = classifySentiment(entry.text);
  const signals = signalsFor(perItem, entry.tmdbId, entry.mediaType, entry.createdAt);
  if (isNewer(signals.comment, entry.createdAt))
    signals.comment = { sentiment, at: entry.createdAt };
}

/** Combines the per-source weights into a single signed weight per item. */
// fallow-ignore-next-line complexity
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

// fallow-ignore-next-line complexity
function accumulateScorerFeatures(
  features: ProfileFeatures,
  scorer: FeatureScorer,
  contribution: ItemContribution,
  decay: number,
): void {
  if (!isDictScorer(scorer)) return;
  const dict = scorer.extract(contribution.candidate);
  const weight = contribution.weight * (DECAY_CATEGORIES.has(scorer.id) ? decay : 1);
  const bucket = features[scorer.id];
  for (const [feature, rawValue] of Object.entries(dict)) {
    const value = rawValue * weight;
    if (value === 0) continue;
    bucket[feature] = (bucket[feature] ?? 0) + value;
  }
}

function accumulateKeywords(
  features: ProfileFeatures,
  contribution: ItemContribution,
  decay: number,
): void {
  for (const keyword of contribution.noteKeywords) {
    const value = NOTE_KEYWORD_BOOST * contribution.weight * decay;
    features.keywords[keyword] = (features.keywords[keyword] ?? 0) + value;
  }
}

/**
 * Folds the per-item contributions into category dicts, applying the recency
 * decay for genres and keywords.
 */
function aggregate(contributions: Map<string, ItemContribution>, now: number): ProfileFeatures {
  const features = emptyFeatures();
  for (const contribution of contributions.values()) {
    const decay = recencyMultiplier(now, contribution.timestamp);
    for (const scorer of SCORERS) accumulateScorerFeatures(features, scorer, contribution, decay);
    accumulateKeywords(features, contribution, decay);
  }
  return features;
}

function recencyMultiplier(now: number, timestamp: number): number {
  const elapsed = Math.max(0, now - timestamp);
  return Math.pow(0.5, elapsed / HALF_LIFE_MS);
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
  return Object.fromEntries(orderBy(entries, [([, v]) => Math.abs(v)], ["desc"]).slice(0, k));
}

export { SIGNAL_WEIGHTS, TOP_K, HALF_LIFE_MS, NOTE_KEYWORD_BOOST, recencyMultiplier };
