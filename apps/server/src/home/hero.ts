import { orderBy } from "es-toolkit/array";
import type { CompactMediaItem, HeroReason, LayoutHero, RowKind } from "@ent-mcp/shared/home";
import type { CanonicalMetadata, MetadataKey } from "../catalog/types";
import { fromCanonicalMetadata, fromContinueWatchingEntry } from "./adapters";
import type { InternalCompactMediaItem, RowContext } from "./types";

const FINISHING_THRESHOLD = 0.85;
const HERO_POOL = 5;

interface HeroPick {
  item: InternalCompactMediaItem;
  alternates: InternalCompactMediaItem[];
}

interface CascadeStep {
  source: RowKind;
  reason: HeroReason;
  get: (ctx: RowContext) => Promise<HeroPick | null>;
}

const CASCADE: CascadeStep[] = [
  { source: "continueWatching", reason: "continue_watching", get: pickContinueWatchingHero },
  { source: "recommendedForYou", reason: "recommended", get: pickRecommendedHero },
  { source: "trendingNow", reason: "trending", get: pickTrendingHero },
  { source: "newReleases", reason: "new_release", get: pickNewReleaseHero },
];

/**
 * Hero cascade — first source that yields a hit wins. Each picker returns
 * the head item plus up to four alternates drawn from the same source pool
 * (alternates feed the backdrop crossfade in the dashboard top zone). The
 * cascade returns `null` when every source is empty for the user.
 *
 * `resolveResumeUrl` is always `null` v1 — the plugin SDK has no
 * `playback@v1.getResumeUrl` method, so the UI renders Play as nav-to-detail.
 */
export async function pickHero(ctx: RowContext): Promise<LayoutHero | null> {
  for (const step of CASCADE) {
    const hit = await step.get(ctx);
    if (!hit) continue;
    return {
      item: stripInternal(hit.item),
      source: step.source,
      reason: step.reason,
      resumeUrl: resolveResumeUrl(),
      alternates: hit.alternates.map(stripInternal),
    };
  }
  return null;
}

export function resolveResumeUrl(): string | null {
  return null;
}

export async function pickContinueWatchingHero(ctx: RowContext): Promise<HeroPick | null> {
  if (!(await ctx.mediaService.hasCapabilityProvider("continueWatching", "v1", "user"))) {
    return null;
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
  if (sorted.length === 0) return null;
  const items = sorted
    .slice(0, HERO_POOL)
    .map((entry) => fromContinueWatchingEntry(entry))
    .filter((item): item is InternalCompactMediaItem => item !== null);
  if (items.length === 0) return null;
  const [head, ...rest] = items;
  return { item: head!, alternates: rest };
}

// fallow-ignore-next-line complexity
export async function pickRecommendedHero(ctx: RowContext): Promise<HeroPick | null> {
  const rec = await ctx.catalog.getRecommendations(ctx.userId, "default");
  if (!rec || rec.items.length === 0) return null;
  const keys = rec.items.slice(0, HERO_POOL);
  const metadata = await ctx.catalog.getMetadataBatch(
    keys.map((k) => ({ tmdbId: k.tmdbId, type: k.mediaType })),
  );
  const items: InternalCompactMediaItem[] = [];
  for (const k of keys) {
    const meta = metadata[`${k.mediaType}:${k.tmdbId}`] as CanonicalMetadata | undefined;
    if (!meta) continue;
    items.push(fromCanonicalMetadata(meta, { topContributors: k.topContributors }));
  }
  if (items.length === 0) return null;
  const [head, ...rest] = items;
  return { item: head!, alternates: rest };
}

export async function pickTrendingHero(ctx: RowContext): Promise<HeroPick | null> {
  return pickFromDiscover(ctx, "trending", "popularity_desc");
}

export async function pickNewReleaseHero(ctx: RowContext): Promise<HeroPick | null> {
  return pickFromDiscover(ctx, "newReleases", "popularity_desc");
}

// fallow-ignore-next-line complexity
async function pickFromDiscover(
  ctx: RowContext,
  feedKind: "trending" | "newReleases",
  sort: "popularity_desc",
): Promise<HeroPick | null> {
  const snap = await ctx.catalog.getDiscoverFeed(feedKind, sort, todayBucket());
  if (!snap || snap.length === 0) return null;
  const keys: MetadataKey[] = snap.slice(0, HERO_POOL);
  const metadata = await ctx.catalog.getMetadataBatch(keys);
  const items: InternalCompactMediaItem[] = [];
  for (const k of keys) {
    const meta = metadata[`${k.type}:${k.tmdbId}`] as CanonicalMetadata | undefined;
    if (meta) items.push(fromCanonicalMetadata(meta));
  }
  if (items.length === 0) return null;
  const [head, ...rest] = items;
  return { item: head!, alternates: rest };
}

function todayBucket(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Drops the doubled-underscore internal fields the orchestrator stashes on
 * `InternalCompactMediaItem` (used for downstream match-reason resolution and
 * recently-added windowing) so they never reach the wire.
 */
function stripInternal(item: InternalCompactMediaItem): CompactMediaItem {
  const { __topContributors: _t, __addedAtMs: _a, ...wire } = item;
  return wire;
}
