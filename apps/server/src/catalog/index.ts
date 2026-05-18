export {
  CatalogService,
  type CatalogServiceOptions,
  getCatalogService,
  resetCatalogServiceForTest,
  setCatalogServiceForTest,
} from "./service";
export { CATALOG_EVENTS } from "./events";
export { CatalogServiceError } from "./errors";
export {
  toCanonicalRow,
  asMetadataKey,
  type RawArtwork,
  type RawCanonicalSource,
  toCandidateFeatures,
  extractFeatures,
  candidateId,
} from "./types";
export { registerCatalogJobs as registerJobs, writeRecommendationsForUser } from "./jobs";
