// Pre-existing catalog<->preferences cycle, baselined on sibling jobs/recommendation-build.ts.
// This is the relocated writer body reusing the same preferences service singleton via the barrel.
// fallow-ignore-file circular-dependencies
import type { FeatureCategory } from "@nama/shared/preferences";
import { getPreferencesService, type FeatureContribution } from "../../preferences";
import { MediaService, identifyItem, splitCombinedId } from "../../media";
import type { CatalogService } from "../../catalog";
import type { RecItem, TopContributor, TopContributorCategory } from "@nama/shared/catalog";

const TOP_N = 60;
const CANDIDATE_LIMIT = 180;
const PER_ROW_DEADLINE_SEC = 60;
const TOP_CONTRIBUTORS_PER_REC = 3;

/**
 * Maps the preference engine's plural `FeatureCategory` (`genres`, `people`, …)
 * onto the singular `TopContributorCategory` the home feed surfaces in chips
 * (`genre`, `person`, …). Match-reason resolver branches on this form.
 */
const FEATURE_CATEGORY_TO_TOP_CONTRIBUTOR: Record<FeatureCategory, TopContributorCategory> = {
  genres: "genre",
  keywords: "keyword",
  people: "person",
  decades: "decade",
  runtimes: "runtime",
  languages: "language",
};

function toTopContributors(contributions: readonly FeatureContribution[]): TopContributor[] {
  return contributions.slice(0, TOP_CONTRIBUTORS_PER_REC).map((c) => ({
    category: FEATURE_CATEGORY_TO_TOP_CONTRIBUTOR[c.category],
    value: c.feature,
    weight: c.weight,
  }));
}

export interface CatalogRecommendationBuildDeps {
  catalog: CatalogService;
}

/**
 * Rec-list-only entry point. Assumes profile partitions already current.
 * Used by feature.preference.rebuild manual handler to avoid double-bumping profile_version.
 */
// fallow-ignore-next-line complexity
export async function writeRecommendationsForUser(
  deps: CatalogRecommendationBuildDeps,
  userId: string,
  abortSignal: AbortSignal,
  log: (msg: string) => void = () => {},
): Promise<void> {
  const service = getPreferencesService();
  abortSignal.throwIfAborted();
  // Capture the profile version *before* ranking so a concurrent rebuild
  // (manual `feature.preference.rebuild` or a future webhook ingestion)
  // cannot bump the version mid-flight and leave the rec list referencing
  // a profile state it was not actually ranked against. The rec list now
  // pins the exact version that drove the ranking.
  const profile = await service.getStoredProfile(userId, "combined");
  const profileVersion = profile?.version ?? 0;

  const media = new MediaService(userId);
  const candidates = await media.getRecommendationsFeed({ limit: CANDIDATE_LIMIT });
  // The dispatcher does not consume an abort signal yet; the wall-clock
  // `perRowTimeoutSec` cap guards runaway plugin calls. Re-checking here
  // shortens the window where a cancelled job still does post-fetch work.
  abortSignal.throwIfAborted();
  const candidateItems = candidates.items as RawCandidate[];
  if (candidateItems.length === 0) return;

  const adapted = candidateItems
    .map((item) => adaptCandidate(item))
    .filter((item): item is NonNullable<ReturnType<typeof adaptCandidate>> => item !== null);
  if (adapted.length === 0) return;

  const deadlineMs = Date.now() + PER_ROW_DEADLINE_SEC * 1000;
  const ranked = await service.rankCandidates(userId, adapted, { deadlineMs });
  abortSignal.throwIfAborted();
  const topN = ranked.slice(0, TOP_N);
  if (topN.length === 0) return;

  const recItems: RecItem[] = await Promise.all(
    topN.map(async (entry) => {
      const reason = await service.explainRanked(userId, entry).catch(() => null);
      return {
        tmdbId: splitCombinedId(entry.item.id)?.id ?? "",
        mediaType: entry.item.type,
        matchReason: reason,
        topContributors: toTopContributors(entry.topContributors ?? []),
        score: entry.score,
      };
    }),
  );
  const validItems = recItems.filter((entry) => entry.tmdbId.length > 0);
  if (validItems.length === 0) return;

  abortSignal.throwIfAborted();
  await deps.catalog.writeRecommendationList(userId, "default", validItems, profileVersion);
  log(
    `[catalog:recommendation-build] user=${userId} wrote ${validItems.length} recs (pv=${profileVersion})`,
  );
}

type RawCandidate = {
  id?: string;
  type?: "movie" | "tv";
  title?: string;
  ids?: { tmdb_id?: string };
  year?: number | null;
  overview?: string;
  posterUrl?: string | null;
  rating?: number | null;
};

function parseIdentity(item: RawCandidate): { id: string; type: "movie" | "tv" } | null {
  const identity = identifyItem(item);
  if (!identity) return null;
  return { id: `${identity.type}:${identity.tmdbId}`, type: identity.type };
}

// fallow-ignore-next-line complexity
function adaptCandidate(item: RawCandidate): {
  id: string;
  title: string;
  year: number;
  type: "movie" | "tv";
  genres: string[];
  rating: number | null;
  overview: string;
  posterUrl: string | null;
  status: "unknown";
  userRating: null;
  matchReason: null;
} | null {
  const identity = parseIdentity(item);
  if (!identity) return null;
  return {
    id: identity.id,
    title: item.title ?? identity.id,
    year: typeof item.year === "number" ? item.year : 0,
    type: identity.type,
    genres: [],
    rating: item.rating ?? null,
    overview: item.overview ?? "",
    posterUrl: item.posterUrl ?? null,
    status: "unknown",
    userRating: null,
    matchReason: null,
  };
}
