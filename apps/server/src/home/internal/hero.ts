import { groupBy, orderBy } from "es-toolkit/array";
import type { HeroReason, HeroSlide, LayoutHero, RowKind } from "@nama/shared/home";
import type { MetadataKey } from "@nama/shared/catalog";
import { isActiveContinueWatchingEntry } from "../../media";
import { fromContinueWatchingEntry } from "./adapters";
import { enrichHomeItems } from "./media-enrichment";
import { loadCanonicalItems } from "../rows/_shared";
import type { InternalCompactMediaItem, RowContext } from "./types";

const HERO_TARGET = 6;
// Per-source pool ceiling. Set to `HERO_TARGET` so the worst-case backfill —
// every other source empty, one source carries the full hero — has enough
// candidates to fill `HERO_TARGET` slots without re-fetching.
const POOL_SIZE = 6;

const QUOTA: Partial<Record<RowKind, number>> = {
  continueWatching: 1,
  recommendedForYou: 2,
  trendingNow: 2,
  newReleases: 1,
};

const PRIORITY: RowKind[] = ["continueWatching", "recommendedForYou", "trendingNow", "newReleases"];

interface HeroSlideInternal {
  item: InternalCompactMediaItem;
  source: RowKind;
  reason: HeroReason;
  resumeUrl: string | null;
}

type PoolMap = Partial<Record<RowKind, HeroSlideInternal[]>>;

function slideKey(slide: HeroSlideInternal): string {
  return `${slide.source}:${slide.item.tmdbId}`;
}

function stampSlide(
  item: InternalCompactMediaItem,
  source: RowKind,
  reason: HeroReason,
): HeroSlideInternal {
  return { item, source, reason, resumeUrl: null };
}

// Amendment 3 (rev 5) of `docs/2026-05-05-home-page-backend-design.md`.
// Fixed quota: 1 continueWatching + 2 recommendedForYou + 2 trendingNow + 1 newReleases.
// Dedup pools by `${mediaType}:${tmdbId}` (higher priority wins); backfill unmet quotas; order as:
// lead (first non-empty source) + round-robin interleave of remainder.
export async function pickHero(ctx: RowContext): Promise<LayoutHero | null> {
  // Per-pool catches: a single slow / failing source must not null the whole
  // hero. Each loadPool rejection collapses to `[]`, mixer + backfill then
  // draw from the remaining pools (consistent with rev 4 degenerate-fill
  // intent — hero ships < 6 slides rather than disappearing).
  const pools = await Promise.all(
    PRIORITY.map((src) =>
      loadPool(src, ctx).catch((err: unknown) => {
        ctx.logger.warn(`[home:hero] pool ${src} threw`, err);
        return [] as HeroSlideInternal[];
      }),
    ),
  );
  const rawPoolsByKind: PoolMap = {};
  PRIORITY.forEach((src, i) => {
    rawPoolsByKind[src] = pools[i] ?? [];
  });
  const poolsByKind = dedupePools(rawPoolsByKind, PRIORITY);

  const drafts = drawByQuota(poolsByKind, QUOTA, PRIORITY);
  const filled = backfill(drafts, poolsByKind, HERO_TARGET, PRIORITY);
  if (filled.length === 0) return null;

  const ordered = orderCascadeLeadInterleave(filled, PRIORITY);
  let enrichedItems: Awaited<ReturnType<typeof enrichHomeItems>>["items"];
  try {
    const enriched = await enrichHomeItems(
      ordered.map((s) => s.item),
      ctx,
      { rowId: "hero" },
    );
    enrichedItems = enriched.items;
  } catch (err) {
    ctx.logger.warn("[home:hero] enrichHomeItems threw, dropping hero", err);
    return null;
  }
  if (enrichedItems.length !== ordered.length) {
    ctx.logger.warn("[home:hero] enrichment dropped items, dropping hero");
    return null;
  }
  const slides: HeroSlide[] = ordered.map((s, i) => ({
    item: enrichedItems[i]!,
    source: s.source,
    reason: s.reason,
    resumeUrl: resolveResumeUrl(s),
  }));
  return { slides };
}

/**
 * Always `null` v1 — plugin SDK has no `playback@v1.getResumeUrl` method, so
 * Play is rendered as nav-to-detail. Per Amendment 3 §Wire shape (R2).
 */
function resolveResumeUrl(_slide: HeroSlideInternal): string | null {
  return null;
}

// fallow-ignore-next-line complexity
function loadPool(source: RowKind, ctx: RowContext): Promise<HeroSlideInternal[]> {
  switch (source) {
    case "continueWatching":
      return loadContinueWatchingPool(ctx);
    case "recommendedForYou":
      return loadRecommendedPool(ctx);
    case "trendingNow":
      return loadDiscoverPool(ctx, "trending", "popularity_desc", "trendingNow", "trending");
    case "newReleases":
      return loadDiscoverPool(ctx, "newReleases", "popularity_desc", "newReleases", "new_release");
    default:
      return Promise.resolve([]);
  }
}

async function loadContinueWatchingPool(ctx: RowContext): Promise<HeroSlideInternal[]> {
  if (!(await ctx.mediaService.hasCapabilityProvider("continueWatching", "v1", "user"))) {
    return [];
  }
  const res = await ctx.mediaService.getContinueWatchingFeed({ deadlineMs: ctx.deadlineMs });
  const eligible = res.items.filter(isActiveContinueWatchingEntry);
  const sorted = orderBy(eligible, [(entry) => entry.lastPlayedAt ?? ""], ["desc"]);
  const items = sorted
    .slice(0, POOL_SIZE)
    .map((entry) => fromContinueWatchingEntry(entry))
    .filter((item): item is InternalCompactMediaItem => item !== null);
  return items.map((item) => stampSlide(item, "continueWatching", "continue_watching"));
}

async function loadRecommendedPool(ctx: RowContext): Promise<HeroSlideInternal[]> {
  // Share the request-scoped rec-list fetch with the recommendedForYou rows
  // when the memo is present; fall back to a direct fetch otherwise. The
  // fallback arm only fires for a memo-less `RowContext` (tests / manual
  // construction) — `buildContext` always injects the memo, so no real request
  // path reaches it.
  const rec = await (ctx.recommendations
    ? ctx.recommendations()
    : ctx.catalog.getRecommendations(ctx.userId, "default"));
  if (!rec || rec.items.length === 0) return [];
  const keys = rec.items
    .slice(0, POOL_SIZE)
    .map((k) => ({ tmdbId: k.tmdbId, type: k.mediaType, topContributors: k.topContributors }));
  const items = await loadCanonicalItems(ctx, keys, {
    fromOptions: (k) => ({ topContributors: k.topContributors }),
  });
  return items.map((item) => stampSlide(item, "recommendedForYou", "recommended"));
}

async function loadDiscoverPool(
  ctx: RowContext,
  feedKind: "trending" | "newReleases",
  sort: "popularity_desc",
  source: RowKind,
  reason: HeroReason,
): Promise<HeroSlideInternal[]> {
  const snap = await ctx.catalog.getDiscoverFeed(feedKind, sort, todayBucket());
  if (!snap || snap.length === 0) return [];
  const keys: MetadataKey[] = snap.slice(0, POOL_SIZE);
  const items = await loadCanonicalItems(ctx, keys);
  return items.map((item) => stampSlide(item, source, reason));
}

/**
 * Drop cross-source duplicates by `${mediaType}:${tmdbId}`, walking `priority`
 * so the higher-priority source keeps the slide. Within each retained pool,
 * draw order is preserved so quota/backfill/interleave behavior is unchanged.
 */
export function dedupePools(poolsByKind: PoolMap, priority: RowKind[]): PoolMap {
  const seen = new Set<string>();
  const out: PoolMap = {};
  for (const src of priority) {
    const pool = poolsByKind[src] ?? [];
    out[src] = pool.filter((slide) => {
      const key = `${slide.item.mediaType}:${slide.item.tmdbId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  return out;
}

// fallow-ignore-next-line complexity
export function drawByQuota(
  poolsByKind: PoolMap,
  quota: Partial<Record<RowKind, number>>,
  priority: RowKind[],
): HeroSlideInternal[] {
  const drafts: HeroSlideInternal[] = [];
  for (const src of priority) {
    const pool = poolsByKind[src] ?? [];
    const n = Math.min(pool.length, quota[src] ?? 0);
    for (let i = 0; i < n; i++) drafts.push(pool[i]!);
  }
  return drafts;
}

// fallow-ignore-next-line complexity
function fillOnePass(
  out: HeroSlideInternal[],
  used: Set<string>,
  poolsByKind: PoolMap,
  target: number,
  priority: RowKind[],
): boolean {
  let progressed = false;
  for (const src of priority) {
    if (out.length >= target) break;
    const pool = poolsByKind[src] ?? [];
    const next = pool.find((s) => !used.has(slideKey(s)));
    if (!next) continue;
    out.push(next);
    used.add(slideKey(next));
    progressed = true;
  }
  return progressed;
}

export function backfill(
  drafts: HeroSlideInternal[],
  poolsByKind: PoolMap,
  target: number,
  priority: RowKind[],
): HeroSlideInternal[] {
  if (drafts.length >= target) return drafts;
  const out = [...drafts];
  const used = new Set(out.map(slideKey));
  while (out.length < target && fillOnePass(out, used, poolsByKind, target, priority)) {
    // Loop until no source can contribute more or target met.
  }
  return out;
}

type Queues = Record<string, HeroSlideInternal[]>;

function buildQueues(slides: HeroSlideInternal[], priority: RowKind[]): Queues {
  const grouped = groupBy(slides, (s) => s.source) as Partial<Record<RowKind, HeroSlideInternal[]>>;
  const queues: Queues = {};
  for (const src of priority) queues[src] = [...(grouped[src] ?? [])];
  return queues;
}

function shiftLead(
  queues: Queues,
  priority: RowKind[],
): { lead: HeroSlideInternal; leadIdx: number } | null {
  for (let i = 0; i < priority.length; i++) {
    const q = queues[priority[i]!]!;
    if (q.length > 0) return { lead: q.shift()!, leadIdx: i };
  }
  return null;
}

function interleaveRest(queues: Queues, priority: RowKind[]): HeroSlideInternal[] {
  const rest: HeroSlideInternal[] = [];
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const src of priority) {
      const q = queues[src]!;
      if (q.length === 0) continue;
      rest.push(q.shift()!);
      progressed = true;
    }
  }
  return rest;
}

/**
 * Interleave starting AFTER lead's source (matches design doc §Hero composition example).
 * Lead's source rotates to the end to avoid double-firing on first pass.
 */
export function orderCascadeLeadInterleave(
  slides: HeroSlideInternal[],
  priority: RowKind[],
): HeroSlideInternal[] {
  if (slides.length === 0) return slides;
  const queues = buildQueues(slides, priority);
  const head = shiftLead(queues, priority);
  if (!head) return slides;
  const rotated = [...priority.slice(head.leadIdx + 1), ...priority.slice(0, head.leadIdx + 1)];
  return [head.lead, ...interleaveRest(queues, rotated)];
}

function todayBucket(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
