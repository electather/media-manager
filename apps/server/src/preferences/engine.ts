import type { MediaItem } from "@ent-mcp/shared/media";
import type {
  FeedbackAction,
  PreferenceProfile,
  ProfileMediaType,
  RebuildResult,
  UpdateResult,
} from "@ent-mcp/shared/preferences";
import { feedbackLog } from "./feedback-log";
import { renderMatchReason, renderProfileUpdate, explainAgainstProfile } from "./explain";
import { applyIncrementalUpdate } from "./incremental";
import { rebuildProfile } from "./rebuild";
import { profileStorage } from "./storage";
import { rankCandidatesAgainst, resolveEffectiveProfile } from "./scoring";
import type { PreferenceDataProvider } from "./provider";
import { rawItemToCandidateFeatures, type RawMediaItem } from "./provider";
import type { CandidateFeatures, RankedCandidate, UserItemFeedback } from "./types";

export interface PreferenceEngineDeps {
  provider: PreferenceDataProvider;
}

export interface RankOptions {
  alpha?: number;
  mediaType?: "movie" | "tv" | "any";
  /**
   * Wall-clock deadline (ms-epoch) for cold-fill plugin dispatch inside
   * `enrichCandidates`. Catalog reads stay unbounded since they're sub-ms;
   * the deadline only short-circuits the per-item plugin fallback path.
   * Items past the deadline drop out with no features (engine treats the
   * thinned set as lower confidence).
   */
  deadlineMs?: number;
}

const COLD_FILL_CONCURRENCY = 10;

/**
 * Host-owned engine. Owns profile read/write, scoring, explanation, and both
 * rebuild and incremental update paths. Callers inject a `PreferenceDataProvider`
 * so the engine never reaches into the plugin runtime directly.
 */
export class PreferenceEngine {
  constructor(private readonly deps: PreferenceEngineDeps) {}

  // fallow-ignore-next-line unused-class-member
  async rankCandidates(
    userId: string,
    candidates: ReadonlyArray<MediaItem>,
    opts: RankOptions = {},
  ): Promise<RankedCandidate[]> {
    if (candidates.length === 0) return [];
    const profile = await this.resolveProfileForMedia(userId, opts.mediaType);
    const enriched = await this.enrichCandidates(userId, candidates, opts.deadlineMs);
    return rankCandidatesAgainst(enriched, profile, { alpha: opts.alpha });
  }

  /**
   * Explain a candidate that has already been ranked. Reuses the features
   * captured on the RankedCandidate so the explanation does not trigger a
   * second metadata fetch.
   */
  // fallow-ignore-next-line unused-class-member
  async explainRanked(userId: string, ranked: RankedCandidate): Promise<string | null> {
    const profile = await this.resolveProfileForMedia(userId, ranked.item.type);
    return explainAgainstProfile(ranked.features, profile);
  }

  // fallow-ignore-next-line unused-class-member
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

  // fallow-ignore-next-line unused-class-member
  rebuildProfile(
    userId: string,
    mediaType: ProfileMediaType,
    abortSignal?: AbortSignal,
  ): Promise<RebuildResult> {
    return rebuildProfile({ provider: this.deps.provider, abortSignal }, userId, mediaType);
  }

  // fallow-ignore-next-line unused-class-member
  applyIncrementalUpdate(userId: string): Promise<UpdateResult> {
    return applyIncrementalUpdate({ provider: this.deps.provider }, userId);
  }

  // fallow-ignore-next-line unused-class-member
  getProfile(userId: string, mediaType: ProfileMediaType): Promise<PreferenceProfile | null> {
    return profileStorage.read(userId, mediaType);
  }

  // fallow-ignore-next-line unused-class-member
  getUserFeedbackFor(
    userId: string,
    tmdbId: string,
    mediaType: "movie" | "tv",
  ): Promise<UserItemFeedback | null> {
    return feedbackLog.latestForItem(userId, tmdbId, mediaType);
  }

  /** Exposed so tests can verify the rendered reason string without ranking. */
  // fallow-ignore-next-line unused-class-member
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

  // fallow-ignore-next-line complexity
  private async enrichCandidates(
    userId: string,
    candidates: ReadonlyArray<MediaItem>,
    deadlineMs: number | undefined,
  ): Promise<Array<{ item: MediaItem; features: CandidateFeatures }>> {
    const enriched: Array<{ item: MediaItem; features: CandidateFeatures }> = [];
    // Bound cold-fill fan-out so a fully cold catalog can't storm the
    // upstream metadata plugin. Catalog hits inside `featuresForCandidate`
    // remain effectively unbounded — a sub-ms PK lookup is cheap, and
    // chunking buys nothing on the warm path.
    for (let i = 0; i < candidates.length; i += COLD_FILL_CONCURRENCY) {
      if (deadlineMs !== undefined && Date.now() > deadlineMs) break;
      const slice = candidates.slice(i, i + COLD_FILL_CONCURRENCY);
      const results = await Promise.all(
        slice.map(async (candidate) => {
          if (deadlineMs !== undefined && Date.now() > deadlineMs) return null;
          const features = await this.featuresForCandidate(userId, candidate);
          if (!features) return null;
          return { item: candidate, features };
        }),
      );
      for (const entry of results) {
        if (entry) enriched.push(entry);
      }
    }
    return enriched;
  }

  // fallow-ignore-next-line complexity
  private async featuresForCandidate(
    userId: string,
    candidate: MediaItem,
  ): Promise<CandidateFeatures | null> {
    const direct = rawItemToCandidateFeatures(candidate as RawMediaItem);
    if (direct && hasRichFeatures(direct)) return direct;
    const [, tmdbId] = candidate.id.split(":");
    if (!tmdbId) return direct ?? null;
    const provided = await this.deps.provider.getItemFeatures(userId, tmdbId, candidate.type);
    return provided ?? direct ?? null;
  }
}

// fallow-ignore-next-line complexity
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
// fallow-ignore-next-line complexity
function hasRichFeatures(candidate: CandidateFeatures): boolean {
  const keywordsPresent = (candidate.keywords?.length ?? 0) > 0;
  const peoplePresent = Boolean(candidate.director) || (candidate.cast?.length ?? 0) > 0;
  const runtimePresent = typeof candidate.runtime === "number" && candidate.runtime > 0;
  const languagePresent = Boolean(candidate.originalLanguage);
  return keywordsPresent && peoplePresent && runtimePresent && languagePresent;
}

export { feedbackLog };
