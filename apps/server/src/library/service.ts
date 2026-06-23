import type { CompactMediaItem } from "@nama/shared/home";
import type {
  LibraryCollection,
  LibraryCollectionsQueryParsed,
  LibraryCollectionsResponse,
  LibraryFacetCounts,
} from "@nama/shared/library";
import { identifyItem, parseItemDate, type RawPluginItem } from "../media";
import { decodeCollectionsCursor, encodeCollectionsCursor } from "./internal/collections-cursor";
import { asLibraryContext } from "./internal/context";
import { buildEnrichRows } from "./internal/enrich";
import { bustFacets, readFacets, writeFacets } from "./internal/facets-cache";
import { hydrate, type HydrateOptions, type HydrateResult } from "./internal/hydrate";
import { toLensFilters } from "./internal/lens-filters";
import {
  allKnownKeys,
  clearSeedLock,
  selectCollections,
  selectFacets,
  selectRowsByIds,
  tombstoneMissing,
  trySeedLock,
  upsertOwned,
  type CollectionGroup,
  type OwnedRowInput,
} from "./repo";
import type { LibraryContext, MaybeLibraryContext } from "./types";

export type { LibraryContext } from "./types";
export type { HydrateOptions, HydrateResult } from "./internal/hydrate";

/** Outcome of a membership sync. Counts are zero on an empty/absent feed. */
export interface SyncMembershipResult {
  /** New owned rows inserted this run. */
  added: number;
  /** Rows tombstoned (`owned → false`) because they left the feed. */
  removed: number;
  /** True when the `collection@v1` feed was incomplete (a provider errored). */
  partial: boolean;
}

interface ParsedFeed {
  /** New owned rows for keys not already known, ready to insert. */
  newRows: OwnedRowInput[];
  /** Every composite id present in the feed (`"<mediaType>:<tmdbId>"`). */
  feedKeys: string[];
  partial: boolean;
}

/**
 * Phase-1 membership sync (design §Sync + hydrate, phase 1). Diffs `collection@v1` feed:
 * new keys become owned rows; keys absent from COMPLETE feed are tombstoned.
 * Partial/empty feeds never tombstone (absence != un-ownership). Idempotent.
 */
export async function syncMembership(ctx: MaybeLibraryContext): Promise<SyncMembershipResult> {
  const c = asLibraryContext(ctx);
  const known = await allKnownKeys(c.userId);
  const parsed = await fetchAndParseFeed(c, known);
  const added = await upsertOwned(parsed.newRows);
  // Only sweep tombstones from COMPLETE, non-empty feeds; partial/empty feeds
  // cannot distinguish "left collection" from "temporarily unreachable".
  // Sweeping a transient outage would wipe the owned library.
  const removed =
    parsed.partial || parsed.feedKeys.length === 0
      ? 0
      : await tombstoneMissing(c.userId, parsed.feedKeys, Date.now());
  // Bust the facets cache whenever the owned set actually changed so the next
  // `/facets` read recomputes against the new membership. A no-op sync (zero
  // adds, zero removes) leaves the cache so an unchanged library keeps serving
  // the cached totals. This is the same-module invalidation the design calls for
  // — no event bus needed for a concern wholly inside the library module.
  if (added > 0 || removed > 0) await bustFacets(c.userId);
  return { added, removed, partial: parsed.partial };
}

// Eager-seed on first read (mirrors watchlist/internal/reads.ts). Atomically
// claims seed lock; on error rolls back for retry. Hydration stays lazy/async per
// design §Known fuzzy areas. Never fails the read it rode in on.
export async function ensureSeeded(ctx: MaybeLibraryContext): Promise<void> {
  const c = asLibraryContext(ctx);
  const acquired = await trySeedLock(c.userId, Date.now());
  if (!acquired) return;
  try {
    await syncMembership(c);
  } catch (err) {
    // `syncMembership` already swallows feed errors, so reaching here means an
    // unexpected throw (e.g. a DB write failure). Roll the lock back so the next
    // read retries the seed rather than treating the user as permanently seeded.
    c.log.warn("[library:seed] eager seed failed; clearing lock for retry", err);
    await clearSeedLock(c.userId);
  }
}

/**
 * Phase-2 hydrate (design §Sync + hydrate, phase 2). Fills browse projection
 * (sortTitle, year, genres, servers, qualityTiers, watchedState, franchise).
 * Called post-sync (6h) or hourly for availability refresh.
 */
export async function hydrateLibrary(
  ctx: MaybeLibraryContext,
  opts?: HydrateOptions,
): Promise<HydrateResult> {
  return hydrate(asLibraryContext(ctx), opts ?? {});
}

/**
 * Unfiltered facet totals cached per-user (design §Facets). Does NOT eager-seed;
 * waits for lens read's `fetchRawSet` to seed membership (per watchlist precedent).
 */
export async function getFacets(ctx: MaybeLibraryContext): Promise<LibraryFacetCounts> {
  const c = asLibraryContext(ctx);
  const cached = await readFacets(c.userId);
  if (cached) return cached;
  const facets = await selectFacets(c.userId);
  await writeFacets(c.userId, facets);
  return facets;
}

/**
 * Lists owned franchises group-first (design §Collections lens). Eager-seeds
 * membership on first read, pages via repo, enriches previews through lens'
 * dedup-free builder (no re-probe). SQL enforces owned-only + TV/standalone-excluded.
 */
export async function listCollections(
  ctx: MaybeLibraryContext,
  query: LibraryCollectionsQueryParsed,
): Promise<LibraryCollectionsResponse> {
  const c = asLibraryContext(ctx);
  const decoded = decodeCollectionsCursor(query.cursor);
  // Only the first page (no resume cursor) eager-seeds, mirroring the lens
  // sources: a paged-into read already saw a seeded library, so it skips the
  // seed-lock round trip.
  if (!decoded) await ensureSeeded(c);
  const page = await selectCollections(c.userId, toLensFilters(query), decoded, query.limit);
  const previews = await enrichPreviews(c, page.groups);
  const collections = page.groups.map((group) => toLibraryCollection(group, previews));
  const cursor = page.nextGroup ? encodeCollectionsCursor(page.nextGroup) : null;
  return { collections, cursor };
}

/**
 * Batches all groups' preview ids into one `selectRowsByIds` + `buildEnrichRows` call,
 * keeping metadata fan-out to one round trip (not per-franchise).
 */
async function enrichPreviews(
  ctx: LibraryContext,
  groups: CollectionGroup[],
): Promise<Map<string, CompactMediaItem>> {
  const ids = [...new Set(groups.flatMap((group) => group.previewIds))];
  if (ids.length === 0) return new Map();
  const rows = await selectRowsByIds(ctx.userId, ids);
  const { items } = await buildEnrichRows(ctx)(rows);
  return new Map(items.map((item) => [item.id, item]));
}

/**
 * Maps repo group + enriched preview lookup to `LibraryCollection`.
 * Preview walks `group.previewIds`, drops unresolved ids (no blank cards).
 */
function toLibraryCollection(
  group: CollectionGroup,
  previews: Map<string, CompactMediaItem>,
): LibraryCollection {
  const preview = group.previewIds
    .map((id) => previews.get(id))
    .filter((item): item is CompactMediaItem => item != null);
  return {
    id: `collection:${group.collectionId}`,
    title: group.collectionName,
    count: group.count,
    preview,
  };
}

/**
 * Fetches and parses `collection@v1` feed into new rows + keys.
 * Feed errors swallowed (logs info, reports empty `partial` feed for sync no-op).
 */
async function fetchAndParseFeed(ctx: LibraryContext, known: Set<string>): Promise<ParsedFeed> {
  const opts: { deadlineMs?: number } = {};
  if (ctx.deadlineMs != null) opts.deadlineMs = ctx.deadlineMs;
  let items: unknown[];
  let partial: boolean;
  try {
    const feed = await ctx.mediaService.getCollectionFeed(opts);
    items = feed.items;
    partial = feed.partial;
  } catch (err) {
    ctx.log.info("[library:sync] getCollectionFeed unavailable; treating library as empty", err);
    return { newRows: [], feedKeys: [], partial: true };
  }
  return toParsedFeed(ctx.userId, items, known, partial);
}

/** Diffs the raw feed entries into new rows + the full feed-key set. */
function toParsedFeed(
  userId: string,
  items: unknown[],
  known: Set<string>,
  partial: boolean,
): ParsedFeed {
  const newRows: OwnedRowInput[] = [];
  const feedKeys: string[] = [];
  for (const entry of items) {
    const row = toOwnedRow(userId, entry);
    if (!row) continue;
    feedKeys.push(row.id);
    if (!known.has(row.id)) newRows.push(row);
  }
  return { newRows, feedKeys, partial };
}

/**
 * Resolves a single `collection@v1` entry (`{ item, addedAt }`) into an owned
 * row, or null when the item lacks a usable tmdb id / primary type. `ownedAt`
 * falls back to now when `addedAt` is missing or unparseable.
 */
function toOwnedRow(userId: string, entry: unknown): OwnedRowInput | null {
  if (!entry || typeof entry !== "object") return null;
  const { item, addedAt } = entry as { item?: RawPluginItem; addedAt?: string };
  const identity = identifyItem(item);
  if (!identity) return null;
  const id = `${identity.type}:${identity.tmdbId}`;
  return {
    id,
    userId,
    tmdbId: identity.tmdbId,
    mediaType: identity.type,
    ownedAt: parseItemDate(addedAt) ?? Date.now(),
  };
}
