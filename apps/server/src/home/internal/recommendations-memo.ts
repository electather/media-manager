import type { RecommendationList } from "@nama/shared/catalog";
import type { CatalogService } from "../../catalog";

/**
 * Builds a request-scoped accessor for the user's `"default"` recommendation
 * list. A single home compose reads the list from the `recommendedForYou-*`
 * eligibility check, the same row's source `fetchRawSet`, and the hero cascade,
 * across both the tv and movies partitions — up to four reads of one list per
 * render. Memoizing the in-flight promise collapses those to a single
 * `catalog.getRecommendations` call (mirroring the `statusBatch` memo). The
 * promise itself is cached, so concurrent readers share one fetch rather than
 * racing several.
 */
export function makeRecommendationsMemo(
  catalog: CatalogService,
  userId: string,
): () => Promise<RecommendationList | null> {
  let pending: Promise<RecommendationList | null> | undefined;
  return () => {
    pending ??= catalog.getRecommendations(userId, "default");
    return pending;
  };
}
