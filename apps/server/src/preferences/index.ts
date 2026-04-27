import { CatalogService } from "../catalog";
import { getDb } from "../db/client";
import { CatalogPreferenceProvider } from "./catalog-provider";
import { PreferenceEngine } from "./engine";
import { MediaServicePreferenceProvider } from "./media-provider";
import type { PreferenceDataProvider } from "./provider";

let instance: PreferenceEngine | undefined;

/**
 * Returns the singleton engine. Lazily constructed on first call so the
 * module can be safely imported before `bootstrap()` runs (tests, jobs
 * registering at module-load time). The default provider reads features
 * from the catalog and falls back to the live media dispatcher on miss
 * (V45); cold-fill misses persist back via a detached write-back.
 */
export function getPreferenceEngine(): PreferenceEngine {
  if (!instance) {
    const catalog = new CatalogService(getDb());
    const fallback = new MediaServicePreferenceProvider();
    instance = new PreferenceEngine({
      provider: new CatalogPreferenceProvider(catalog, fallback),
    });
  }
  return instance;
}

/** Test helper: swap the underlying engine for the rest of the process. */
export function setPreferenceEngineForTest(provider: PreferenceDataProvider): PreferenceEngine {
  instance = new PreferenceEngine({ provider });
  return instance;
}

/** Test helper: drop the singleton so the next `get` rebuilds from scratch. */
export function resetPreferenceEngineForTest(): void {
  instance = undefined;
}

export { PreferenceEngine } from "./engine";
export { feedbackLog } from "./feedback-log";
export * from "./types";
export type { PreferenceDataProvider, HistorySignal, RatingSignal } from "./provider";
