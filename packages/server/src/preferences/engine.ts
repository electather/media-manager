import type { MediaItem } from "../media/types";
import { feedbackLog } from "./feedback-log";
import { renderMatchReason, renderProfileUpdate, explainAgainstProfile } from "./explain";
import { applyIncrementalUpdate } from "./incremental";
import { rebuildProfile } from "./rebuild";
import { profileStorage } from "./storage";
import { rankCandidatesAgainst, resolveEffectiveProfile } from "./scoring";
import type { PreferenceDataProvider } from "./provider";
import { toCandidateFeatures, type RawMediaItem } from "./provider";
import type {
  CandidateFeatures,
  FeedbackAction,
  PreferenceProfile,
  ProfileMediaType,
  RankedCandidate,
  RebuildResult,
  UpdateResult,
  UserItemFeedback,
} from "./types";

export interface PreferenceEngineDeps {
  provider: PreferenceDataProvider;
}

export interface RankOptions {
  alpha?: number;
  mediaType?: "movie" | "tv" | "any";
}

/**
 * Host-owned engine. Owns profile read/write, scoring, explanation, and both
 * rebuild and incremental update paths. Callers inject a `PreferenceDataProvider`
 * so the engine never reaches into the plugin runtime directly.
 */
export class PreferenceEngine {
  constructor(private readonly deps: PreferenceEngineDeps) {}

  async rankCandidates(
    userId: string,
    candidates: ReadonlyArray<MediaItem>,
    opts: RankOptions = {},
  ): Promise<RankedCandidate[]> {
    if (candidates.length === 0) return [];
    const profile = await this.resolveProfileForMedia(userId, opts.mediaType);
    const enriched = await this.enrichCandidates(userId, candidates);
    return rankCandidatesAgainst(enriched, profile, { alpha: opts.alpha });
  }

  async explainMatch(userId: string, candidate: MediaItem): Promise<string | null> {
    const profile = await this.resolveProfileForMedia(userId, candidate.type);
    const features = await this.featuresForCandidate(userId, candidate);
    if (!features) return null;
    return explainAgainstProfile(features, profile);
  }

  async previewFeedbackEffect(
    userId: string,
    item: MediaItem,
    action: FeedbackAction,
    opts: { rating?: number; note?: string } = {},
  ): Promise<string | null> {
    const profile = await this.resolveProfileForMedia(userId, item.type);
    const features = await this.featuresForCandidate(userId, item);
    if (!features) return null;
    const sentiment = resolvePreviewSentiment(action, opts);
    return renderProfileUpdate(features, action, profile, {
      sentiment,
      title: item.title,
    });
  }

  rebuildProfile(userId: string, mediaType: ProfileMediaType): Promise<RebuildResult> {
    return rebuildProfile({ provider: this.deps.provider }, userId, mediaType);
  }

  applyIncrementalUpdate(userId: string): Promise<UpdateResult> {
    return applyIncrementalUpdate({ provider: this.deps.provider }, userId);
  }

  getProfile(userId: string, mediaType: ProfileMediaType): Promise<PreferenceProfile | null> {
    return profileStorage.read(userId, mediaType);
  }

  getUserFeedbackFor(
    userId: string,
    tmdbId: string,
    mediaType: "movie" | "tv",
  ): Promise<UserItemFeedback | null> {
    return feedbackLog.latestForItem(userId, tmdbId, mediaType);
  }

  /** Exposed so tests can verify the rendered reason string without ranking. */
  renderMatchReason(contribution: RankedCandidate): string | null {
    return renderMatchReason(contribution.topContributors);
  }

  private async resolveProfileForMedia(
    userId: string,
    mediaType: MediaItem["type"] | "any" | undefined,
  ): Promise<PreferenceProfile | null> {
    const combined = await profileStorage.read(userId, "combined");
    if (!mediaType || mediaType === "any") {
      return (
        combined ??
        (await profileStorage.read(userId, "movie")) ??
        (await profileStorage.read(userId, "tv"))
      );
    }
    const typed = await profileStorage.read(userId, mediaType);
    return resolveEffectiveProfile(typed, combined).profile;
  }

  private async enrichCandidates(
    userId: string,
    candidates: ReadonlyArray<MediaItem>,
  ): Promise<Array<{ item: MediaItem; features: CandidateFeatures }>> {
    const results = await Promise.all(
      candidates.map(async (candidate) => {
        const features = await this.featuresForCandidate(userId, candidate);
        if (!features) return null;
        return { item: candidate, features };
      }),
    );
    return results.filter(
      (entry): entry is { item: MediaItem; features: CandidateFeatures } => entry !== null,
    );
  }

  private async featuresForCandidate(
    userId: string,
    candidate: MediaItem,
  ): Promise<CandidateFeatures | null> {
    const direct = toCandidateFeatures(candidate as RawMediaItem);
    if (direct && hasRichFeatures(direct)) return direct;
    const [, tmdbId] = candidate.id.split(":");
    if (!tmdbId) return direct ?? null;
    const provided = await this.deps.provider.getItemFeatures(userId, tmdbId, candidate.type);
    return provided ?? direct ?? null;
  }
}

function resolvePreviewSentiment(
  action: FeedbackAction,
  opts: { rating?: number; note?: string },
): "positive" | "negative" | "neutral" {
  if (action === "like") return "positive";
  if (action === "dislike") return "negative";
  if (action === "rate") {
    if (typeof opts.rating !== "number") return "neutral";
    if (opts.rating >= 8) return "positive";
    if (opts.rating <= 3) return "negative";
    return "neutral";
  }
  if (!opts.note) return "neutral";
  // Preview doesn't re-run the classifier — the MCP handler writes the row
  // first (which does run it) and the preview just stays neutral until the
  // next rank. This matches the design's "slight disagreement is acceptable."
  return "neutral";
}

/** True when a candidate already carries the fields needed for full scoring. */
function hasRichFeatures(candidate: CandidateFeatures): boolean {
  const keywordsPresent = (candidate.keywords?.length ?? 0) > 0;
  const peoplePresent = Boolean(candidate.director) || (candidate.cast?.length ?? 0) > 0;
  const runtimePresent = typeof candidate.runtime === "number" && candidate.runtime > 0;
  const languagePresent = Boolean(candidate.originalLanguage);
  return keywordsPresent && peoplePresent && runtimePresent && languagePresent;
}

export { feedbackLog };
