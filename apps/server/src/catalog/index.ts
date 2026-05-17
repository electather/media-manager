import { getDb } from "../db/client";
import { CatalogService } from "./service";

export { CatalogService, type CatalogServiceOptions } from "./service";
export {
  toCanonicalRow,
  asMetadataKey,
  type RawArtwork,
  type RawCanonicalSource,
} from "./canonical";
export { toCandidateFeatures, extractFeatures, candidateId } from "./features";
export { registerCatalogJobs, registerCatalogJobs as registerJobs } from "./jobs";
export { writeRecommendationsForUser } from "./jobs/recommendation-build";

let instance: CatalogService | undefined;

/**
 * Returns the process-wide singleton. The catalog is intentionally a single
 * instance per process so per-process state (Phase 6's `recordAccess`
 * throttle map) stays consistent across every read site — preference
 * engine, scheduled jobs, and home-feed handlers all share one map.
 */
export function getCatalogService(): CatalogService {
  if (!instance) instance = new CatalogService(getDb());
  return instance;
}

/** Test helper: drop the singleton so the next `get` rebuilds from scratch. */
export function resetCatalogServiceForTest(): void {
  instance = undefined;
}

/** Test helper: install an arbitrary catalog instance (e.g. with an in-memory DB). */
export function setCatalogServiceForTest(svc: CatalogService): void {
  instance = svc;
}
