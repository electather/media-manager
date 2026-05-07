import { groupBy, orderBy } from "es-toolkit/array";
import type { HeroReason, HeroSlide, LayoutHero, RowKind } from "@ent-mcp/shared/home";
import type { CanonicalMetadata, MetadataKey } from "../catalog/types";
import { fromCanonicalMetadata, fromContinueWatchingEntry } from "./adapters";
import { enrichItems } from "./enrich";
import type { InternalCompactMediaItem, RowContext } from "./types";

const FINISHING_THRESHOLD = 0.85;
const HERO_TARGET = 6;
const POOL_SIZE = 6;

const QUOTA: Record<RowKind, number> = {
  continueWatching: 1,
  recommendedForYou: 2,
  trendingNow: 2,
  newReleases: 1,
} as Record<RowKind, number>;

const PRIORITY: RowKind[] = ["continueWatching", "recommendedForYou", "trendingNow", "newReleases"];

interface HeroSlideInternal {
  item: InternalCompactMediaItem;
  source: RowKind;
  reason: HeroReason;
  resumeUrl: string | null;
}

type PoolMap = Partial<Record<RowKind, HeroSlideInternal[]>>;

/**
 * Hero mixer — Amendment 3 (rev 4) of `docs/2026-05-05-home-page-backend-design.md`.
 *
 * Replaces the old first-source-wins cascade with a fixed-quota mix across all
 * four sources: 1 continueWatching + 2 recommendedForYou + 2 trendingNow + 1
 * newReleases (= 6). When a source is short, `backfill` walks the priority
 * order `[CW, rec, trend, new]` taking the next unused candidate per pass
 * until either the target is reached or every pool is exhausted (degenerate
 * fill ships < 6). Final ordering: lead = first non-empty priority source;
 * remainder = round-robin interleave by priority. Within hero, slides are
 * unique by `${source}:${tmdbId}` by construction; no dedup against the rows
 * below.
 */
export async function pickHero(ctx: RowContext): Promise<LayoutHero | null> {
  const pools = await Promise.all(PRIORITY.map((src) => loadPool(src, ctx)));
  const poolsByKind: PoolMap = {};
  PRIORITY.forEach((src, i) => {
    poolsByKind[src] = pools[i] ?? [];
  });

  const drafts = drawByQuota(poolsByKind, QUOTA);
  const filled = backfill(drafts, poolsByKind, HERO_TARGET, PRIORITY);
  if (filled.length === 0) return null;

  const ordered = orderCascadeLeadInterleave(filled, PRIORITY);
  const enriched = await enrichItems(
    ordered.map((s) => s.item),
    ctx,
    { rowId: "hero" },
  );
  const slides: HeroSlide[] = ordered.map((s, i) => ({
    item: enriched[i]!,
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
export function resolveResumeUrl(_slide: HeroSlideInternal): string | null {
  return null;
}

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
  // fallow-ignore-next-line complexity
  const eligible = res.items.filter((entry) => {
    const ms = entry.progressMs;
    if (ms === undefined || ms <= 0) return false;
    const total = entry.item.durationSec;
    if (total === undefined || total <= 0) return true;
    return ms / 1000 / total < FINISHING_THRESHOLD;
  });
  const sorted = orderBy(eligible, [(entry) => entry.lastPlayedAt ?? ""], ["desc"]);
  const items = sorted
    .slice(0, POOL_SIZE)
    .map((entry) => fromContinueWatchingEntry(entry))
    .filter((item): item is InternalCompactMediaItem => item !== null);
  return items.map((item) => ({
    item,
    source: "continueWatching",
    reason: "continue_watching",
    resumeUrl: null,
  }));
}

async function loadRecommendedPool(ctx: RowContext): Promise<HeroSlideInternal[]> {
  const rec = await ctx.catalog.getRecommendations(ctx.userId, "default");
  if (!rec || rec.items.length === 0) return [];
  const keys = rec.items.slice(0, POOL_SIZE);
  const metadata = await ctx.catalog.getMetadataBatch(
    keys.map((k) => ({ tmdbId: k.tmdbId, type: k.mediaType })),
  );
  const slides: HeroSlideInternal[] = [];
  for (const k of keys) {
    const meta = metadata[`${k.mediaType}:${k.tmdbId}`] as CanonicalMetadata | undefined;
    if (!meta) continue;
    slides.push({
      item: fromCanonicalMetadata(meta, { topContributors: k.topContributors }),
      source: "recommendedForYou",
      reason: "recommended",
      resumeUrl: null,
    });
  }
  return slides;
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
  const metadata = await ctx.catalog.getMetadataBatch(keys);
  const slides: HeroSlideInternal[] = [];
  for (const k of keys) {
    const meta = metadata[`${k.type}:${k.tmdbId}`] as CanonicalMetadata | undefined;
    if (!meta) continue;
    slides.push({
      item: fromCanonicalMetadata(meta),
      source,
      reason,
      resumeUrl: null,
    });
  }
  return slides;
}

export function drawByQuota(
  poolsByKind: PoolMap,
  quota: Record<RowKind, number>,
): HeroSlideInternal[] {
  const drafts: HeroSlideInternal[] = [];
  for (const src of PRIORITY) {
    const pool = poolsByKind[src] ?? [];
    const n = Math.min(pool.length, quota[src] ?? 0);
    for (let i = 0; i < n; i++) drafts.push(pool[i]!);
  }
  return drafts;
}

export function backfill(
  drafts: HeroSlideInternal[],
  poolsByKind: PoolMap,
  target: number,
  priority: RowKind[],
): HeroSlideInternal[] {
  if (drafts.length >= target) return drafts;
  const out = [...drafts];
  const used = new Set(out.map((s) => `${s.source}:${s.item.tmdbId}`));
  while (out.length < target) {
    let progressed = false;
    for (const src of priority) {
      if (out.length >= target) break;
      const pool = poolsByKind[src] ?? [];
      const next = pool.find((s) => !used.has(`${s.source}:${s.item.tmdbId}`));
      if (!next) continue;
      out.push(next);
      used.add(`${next.source}:${next.item.tmdbId}`);
      progressed = true;
    }
    if (!progressed) break;
  }
  return out;
}

export function orderCascadeLeadInterleave(
  slides: HeroSlideInternal[],
  priority: RowKind[],
): HeroSlideInternal[] {
  if (slides.length === 0) return slides;
  const grouped = groupBy(slides, (s) => s.source) as Partial<Record<RowKind, HeroSlideInternal[]>>;
  const queues: Record<string, HeroSlideInternal[]> = {};
  for (const src of priority) queues[src] = [...(grouped[src] ?? [])];

  let lead: HeroSlideInternal | null = null;
  for (const src of priority) {
    const q = queues[src]!;
    if (q.length > 0) {
      lead = q.shift()!;
      break;
    }
  }
  if (!lead) return slides;

  const rest: HeroSlideInternal[] = [];
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const src of priority) {
      const q = queues[src]!;
      if (q.length > 0) {
        rest.push(q.shift()!);
        progressed = true;
      }
    }
  }
  return [lead, ...rest];
}

function todayBucket(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
