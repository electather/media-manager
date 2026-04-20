import { PreferenceEngine } from "./engine";
import { MediaServicePreferenceProvider } from "./media-provider";
import type { PreferenceDataProvider } from "./provider";

let instance: PreferenceEngine | undefined;

/**
 * Returns the singleton engine. Lazily constructed on first call so the
 * module can be safely imported before `bootstrap()` runs (tests, jobs
 * registering at module-load time).
 */
export function getPreferenceEngine(): PreferenceEngine {
  if (!instance) {
    instance = new PreferenceEngine({ provider: new MediaServicePreferenceProvider() });
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
