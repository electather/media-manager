import { mockData } from "./mock-data";
import type { MediaDetailItem } from "./types";

export function findItem(id: string | undefined | null): MediaDetailItem | null {
  if (!id) return null;
  if (mockData.HERO.id === id) return mockData.HERO;
  for (const u of mockData.UPCOMING) if (u.id === id) return u;
  for (const r of mockData.ROWS) for (const it of r.items) if (it.id === id) return it;
  return null;
}
