// fallow-ignore-file code-duplication
// Reason: a faithful client mirror of the server tonight pick/score
// (apps/server/src/watchlist/tonight/{pick,score}.ts). The resolver returns the
// flat unranked candidate page, so the hero/alternate split runs client-side
// (design §B3); the server keeps its copy for the old endpoint until US-013.
import type { CompactMediaItem } from "@nama/shared/media";

/**
 * Tonight-pick scoring weights — kept byte-identical to the server's
 * `WEIGHTS` so the client-side split picks the same hero + alternates the old
 * `/watchlist/sections/tonight` endpoint returned. Higher = better hero.
 */
const WEIGHTS = {
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
const MAX_ALTERNATES = 4;
// Half the ineligible penalty — any candidate below this is dominated by the
// ineligibility weight rather than diversity, runtime, or recency factors.
const INELIGIBLE_CUTOFF = WEIGHTS.ineligible / 2;

/** Client mirror of the server `isActiveProgress` (media/classify.ts). */
function isActiveProgress(progress: CompactMediaItem["progress"]): boolean {
  if (!progress) return false;
  if (progress.total <= 0) return false;
  return progress.watched > 0 && progress.watched < progress.total;
}

// Reason: byte-identical mirror of the server's tonight `genreOverlap` (V.TN1); branch count must match the server copy.
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

/**
 * Score a single candidate. `prior` is the picked hero (or previous
 * alternates) — overlap with `prior` triggers a diversity penalty so the
 * alternate strip varies. Deterministic given identical inputs (V.WL4).
 */
// Reason: byte-identical mirror of the server's tonight `score` (V.TN1); the scoring branches must match the server copy.
// fallow-ignore-next-line complexity
function score(item: CompactMediaItem, prior: CompactMediaItem[], now: number): number {
  let s = 0;
  const inProgress = isActiveProgress(item.progress);
  const available = item.status === "available" && Boolean(item.availability?.hasAnyServerCopy);
  const ineligible =
    item.status === "requested" ||
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

/**
 * Reduce the flat ranked candidate page to `items[0]` hero + ≤4 alternates by
 * descending score with a diversity penalty (design §B3). Empty `candidates` →
 * empty result. Sort is stable: ties break by `id` so the output is
 * deterministic across renders (V.WL4).
 */
// Reason: byte-identical mirror of the server's tonight pick reduce (V.TN1); the sort/cutoff branches must match the server copy.
// fallow-ignore-next-line complexity
export function pickTonight(
  candidates: readonly CompactMediaItem[],
  now: number = Date.now(),
): CompactMediaItem[] {
  if (candidates.length === 0) return [];
  const heroScores = candidates.map((c) => ({ c, s: score(c, [], now) }));
  heroScores.sort((a, b) => b.s - a.s || a.c.id.localeCompare(b.c.id));
  const hero = heroScores[0]!.c;
  const rest = heroScores.slice(1).map((x) => x.c);
  const alternates: CompactMediaItem[] = [];
  const prior: CompactMediaItem[] = [hero];
  for (const item of rest) {
    if (alternates.length >= MAX_ALTERNATES) break;
    const reScore = score(item, prior, now);
    if (reScore <= INELIGIBLE_CUTOFF) continue;
    alternates.push(item);
    prior.push(item);
  }
  return [hero, ...alternates];
}
