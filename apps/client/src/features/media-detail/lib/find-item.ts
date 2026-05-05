import { MOCK_FEED } from "@/features/home/lib/mock-data";
import type { HomeMediaItem } from "@/features/home/lib/types";

/** Resolve a composite `mediaType:mediaId` against the mock feed (hero, alternates, all rows). */
export function findMediaItem(compositeId: string): HomeMediaItem | null {
  const { hero, rows } = MOCK_FEED;
  if (hero) {
    if (hero.id === compositeId) return hero;
    for (const alt of hero.alternates) {
      if (alt.id === compositeId) return alt;
    }
  }
  for (const row of rows) {
    for (const item of row.items) {
      if (item.id === compositeId) return item;
    }
  }
  return null;
}
