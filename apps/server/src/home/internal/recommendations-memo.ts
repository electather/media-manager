import type { RecommendationList } from "@nama/shared/catalog";
import type { CatalogService } from "../../catalog";

/**
 * Memoizes the in-flight `catalog.getRecommendations("default")` promise so one
 * home compose (which reads the list 4+ times across checks/sources/cascade) makes
 * one catalog call. Concurrent readers share the fetch, not race separate calls.
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
