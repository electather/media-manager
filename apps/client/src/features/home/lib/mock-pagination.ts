import type { HomeMediaItem } from "./types";

export const MOCK_PAGE_SIZE = 8;
export const MAX_MOCK_ITEMS = 60;
export const PREFETCH_THRESHOLD = 6;

// Module-scoped so successive page loads across rows generate unique ids.
let cloneCounter = 0;

/** Test helper: resets the module-scoped clone counter so cloned ids stay deterministic between runs. */
export function resetMockCounter() {
  cloneCounter = 0;
}

/**
 * Mock-only paginator used while the home feed runs against fixture data.
 * Clones existing items with new ids until the row hits MAX_MOCK_ITEMS so we
 * can validate scroll-driven prefetch UX without backend integration.
 */
export function generateMockPage(existing: HomeMediaItem[], count: number): HomeMediaItem[] {
  if (existing.length === 0) return [];
  return Array.from({ length: count }, (_, i) => {
    const seed = existing[i % existing.length]!;
    cloneCounter += 1;
    return {
      ...seed,
      id: `${seed.id}#clone-${cloneCounter}`,
      tmdbId: `${seed.tmdbId}-clone-${cloneCounter}`,
    };
  });
}
