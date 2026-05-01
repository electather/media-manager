import { mockData } from "./mock-data";
import type { MediaDetailItem, MediaKind } from "./types";

const PEEK_REGEX = /^(movie|tv):\d+$/;
const PLACEHOLDER_BACKDROP = "https://images.unsplash.com/photo-1542204625-ca960ad6dd64?w=1280";

export function findItem(id: string | undefined | null): MediaDetailItem | null {
  if (!id) return null;
  if (mockData.HERO.id === id) return mockData.HERO;
  for (const u of mockData.UPCOMING) if (u.id === id) return u;
  for (const r of mockData.ROWS) for (const it of r.items) if (it.id === id) return it;
  // Synthetic fallback for valid `<kind>:<id>` peek params not present in
  // local mock fixtures. Replaced by RPC fetch in T44.
  if (PEEK_REGEX.test(id)) return makePlaceholder(id);
  return null;
}

function makePlaceholder(id: string): MediaDetailItem {
  const [kind] = id.split(":") as [MediaKind, string];
  return {
    id,
    kind,
    title: id,
    image: { "16/9": PLACEHOLDER_BACKDROP },
    year: 2025,
    runtime: kind === "movie" ? "—" : undefined,
    overview:
      "Detailed metadata loads from the catalog once T44 wires the live RPC. For now, this is a placeholder body so the peek modal still renders.",
  };
}
