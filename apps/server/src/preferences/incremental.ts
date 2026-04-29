import type {
  FeedbackRecord,
  PreferenceProfile,
  ProfileMediaType,
  UpdateResult,
} from "@ent-mcp/shared/preferences";
import { feedbackLog } from "./feedback-log";
import { SCORERS, isDictScorer } from "./features";
import { rebuildProfile, SIGNAL_WEIGHTS, NOTE_KEYWORD_BOOST } from "./rebuild";
import { profileStorage, type StoredPreferenceProfile } from "./storage";
import type { PreferenceDataProvider } from "./provider";
import { deriveConfidence } from "./types";

export interface IncrementalDeps {
  provider: PreferenceDataProvider;
}

/**
 * Cheap, approximate update. Applies new signals to every partition the user
 * has a profile for — movie/tv/combined — using the same per-item weight
 * hierarchy as rebuild. Deliberately skips re-normalization and pruning so the
 * daily rebuild retains its role as the correction pass.
 */
export async function applyIncrementalUpdate(
  deps: IncrementalDeps,
  userId: string,
  now: number = Date.now(),
): Promise<UpdateResult> {
  const partitions: ProfileMediaType[] = ["movie", "tv", "combined"];
  const profiles = await Promise.all(partitions.map((m) => profileStorage.read(userId, m)));
  const existing = new Map<ProfileMediaType, StoredPreferenceProfile | null>();
  partitions.forEach((m, i) => existing.set(m, profiles[i] ?? null));
  const anyProfile = profiles.find((p): p is StoredPreferenceProfile => p !== null);
  if (!anyProfile) {
    // No profile exists yet — bootstrap all three partitions via a full rebuild
    // so that the first feedback creates a profile rather than silently doing nothing.
    await rebuildProfile(deps, userId, "movie", now);
    await rebuildProfile(deps, userId, "tv", now);
    await rebuildProfile(deps, userId, "combined", now);
    return { userId, applied: 0 };
  }

  const oldest = Math.min(
    ...profiles.filter((p): p is StoredPreferenceProfile => p !== null).map((p) => p.lastUpdatedAt),
  );
  const records = await feedbackLog.readSince(userId, oldest);
  if (records.length === 0) return { userId, applied: 0 };

  let applied = 0;
  for (const record of records) {
    const contribution = await deps.provider.getItemFeatures(
      userId,
      record.tmdbId,
      record.mediaType,
    );
    if (!contribution) continue;
    const weight = recordWeight(record);
    if (weight === 0 && (record.noteKeywords?.length ?? 0) === 0) continue;
    applied += applyRecordToPartitions(record, contribution, weight, partitions, existing);
  }

  for (const partition of partitions) {
    const profile = existing.get(partition) ?? null;
    if (!profile) continue;
    profile.lastUpdatedAt = now;
    profile.confidence = deriveConfidence(profile.sampleSize);
    await profileStorage.write(profile);
  }
  return { userId, applied };
}

function applyRecordToPartitions(
  record: FeedbackRecord,
  contribution: import("./types").CandidateFeatures,
  weight: number,
  partitions: ProfileMediaType[],
  existing: Map<ProfileMediaType, StoredPreferenceProfile | null>,
): number {
  let applied = 0;
  for (const partition of partitions) {
    const profile = existing.get(partition) ?? null;
    if (!profile) continue;
    if (record.createdAt <= profile.lastUpdatedAt) continue;
    if (partition !== "combined" && partition !== record.mediaType) continue;
    applyToProfile(profile, contribution, weight, record);
    applied += 1;
  }
  return applied;
}

function recordWeight(record: FeedbackRecord): number {
  switch (record.action) {
    case "rate":
      if (record.rating === null) return 0;
      if (record.rating >= 8) return SIGNAL_WEIGHTS.rateHigh;
      if (record.rating <= 3) return SIGNAL_WEIGHTS.rateLow;
      return SIGNAL_WEIGHTS.rateMid;
    case "like":
      return SIGNAL_WEIGHTS.like;
    case "dislike":
      return SIGNAL_WEIGHTS.dislike;
    case "note":
      if (record.noteSentiment === "positive") return SIGNAL_WEIGHTS.notePositive;
      if (record.noteSentiment === "negative") return SIGNAL_WEIGHTS.noteNegative;
      return SIGNAL_WEIGHTS.noteNeutral;
  }
}

function applyToProfile(
  profile: PreferenceProfile,
  candidate: import("./types").CandidateFeatures,
  weight: number,
  record: FeedbackRecord,
): void {
  for (const scorer of SCORERS) {
    if (!isDictScorer(scorer)) continue;
    const dict = scorer.extract(candidate);
    for (const [feature, raw] of Object.entries(dict)) {
      const delta = raw * weight;
      if (delta === 0) continue;
      const bucket = profile.features[scorer.id];
      bucket[feature] = (bucket[feature] ?? 0) + delta;
    }
  }
  for (const keyword of record.noteKeywords ?? []) {
    const delta = NOTE_KEYWORD_BOOST * weight;
    if (delta === 0) continue;
    profile.features.keywords[keyword] = (profile.features.keywords[keyword] ?? 0) + delta;
  }
  profile.sampleSize += 1;
}
