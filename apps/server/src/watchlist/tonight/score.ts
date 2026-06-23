import type { CompactMediaItem } from "@nama/shared/home";
import { isActiveProgress } from "../../media";

/**
 * Tonight-pick scoring weights. Centralized so changes are intentional and
 * snapshot-testable (RISK-003). Higher = better hero. See design
 * `docs/2026-05-23-watchlist-sections-design.md` §S.2.
 */
export const WEIGHTS = {
  inProgress: 100,
  availableServer: 80,
  runtimeSweetSpot: 20,
  shortRuntimePenalty: -10,
  recentlyAdded: 15,
  diversityPenalty: -5,
  ineligible: -1000,
} as const;

const SWEET_SPOT_MIN = 90;
const SWEET_SPOT_MAX = 130;
const SHORT_RUNTIME_MAX = 60;
const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// fallow-ignore-next-line complexity
function genreOverlap(a: CompactMediaItem, b: CompactMediaItem): number {
  if (!a.genres || !b.genres) return 0;
  const set = new Set(a.genres.map((g) => g.toLowerCase()));
  let n = 0;
  for (const g of b.genres) {
    if (set.has(g.toLowerCase())) n++;
  }
  return n;
}

/** Score a candidate. Prior (picked hero/alternates) triggers diversity penalty on overlap. Invariant V.WL4: deterministic for identical inputs. */
// fallow-ignore-next-line complexity
export function score(
  item: CompactMediaItem,
  prior: CompactMediaItem[] = [],
  now: number = Date.now(),
): number {
  let s = 0;
  const inProgress = isActiveProgress(item.progress);
  const available = item.status === "available" && Boolean(item.availability?.hasAnyServerCopy);
  const ineligible =
    item.status === "requested" ||
    // Request-provider status (→ awaiting bucket), not the new unavailable bucket
    // (those rows are dropped upstream in getTonightSection's preFilter("ready")).
    item.status === "unavailable" ||
    item.status === "processing" ||
    Boolean(item.facets?.releaseDate);
  if (inProgress) s += WEIGHTS.inProgress;
  if (available) s += WEIGHTS.availableServer;
  const runtime = item.facets?.runtimeMin;
  if (runtime != null) {
    if (runtime >= SWEET_SPOT_MIN && runtime <= SWEET_SPOT_MAX) s += WEIGHTS.runtimeSweetSpot;
    if (runtime < SHORT_RUNTIME_MAX) s += WEIGHTS.shortRuntimePenalty;
  }
  if (item.addedAt != null && now - item.addedAt <= RECENT_WINDOW_MS) s += WEIGHTS.recentlyAdded;
  for (const p of prior) {
    s += genreOverlap(item, p) * WEIGHTS.diversityPenalty;
  }
  if (ineligible && !inProgress) s += WEIGHTS.ineligible;
  return s;
}
