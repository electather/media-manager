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
import { ensureSeeded } from "./internal/reads";
import {
  allKnownKeys,
  selectCollections,
  selectFacets,
  selectRowsByIds,
  tombstoneMissing,
  upsertOwned,
  type CollectionGroup,
  type LensFilters,
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
 * Phase-1 owned-library membership sync (design §Sync + hydrate, phase 1).
 * Diffs the `collection@v1` feed against the known projection:
 *   - keys in the feed but not yet known become new owned rows
 *     (`ownedAt = parseEpoch(entry.addedAt)`); denormalized columns stay at
 *     their defaults until the phase-2 hydrate job runs.
 *   - keys known-and-owned but absent from a COMPLETE feed are tombstoned. A
 *     tombstoned row is never resurrected (`upsertOwned` conflicts do nothing).
 *     A partial or empty/absent feed never tombstones — absence there is not
 *     evidence of un-ownership (see the sweep guard below).
 *
 * Idempotent: a re-run with the same feed inserts and tombstones nothing.
 * Tolerant of an empty/absent feed (no `collection@v1` provider) — no-op,
 * zero counts, never throws to the caller, and never wipes the owned library.
 */
export async function syncMembership(ctx: MaybeLibraryContext): Promise<SyncMembershipResult> {
  const c = asLibraryContext(ctx);
  const known = await allKnownKeys(c.userId);
  const parsed = await fetchAndParseFeed(c, known);
  const added = await upsertOwned(parsed.newRows);
  // Only sweep tombstones from a COMPLETE, non-empty feed. A `partial` feed (a
  // provider errored mid-fan-out) or an empty/absent feed (no provider, a
  // disconnected provider, or a terminal all-providers failure swallowed in
  // `fetchAndParseFeed`) cannot distinguish "left the collection" from
  // "temporarily unreachable" — absence is then not evidence of un-ownership.
  // Sweeping on it would tombstone the entire owned library on a transient
  // outage, so it is skipped; a later complete sync reconciles real removals.
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

/** Alias matching the design's `sync(userId)` job entry point. */
export async function syncLibrary(ctx: MaybeLibraryContext): Promise<SyncMembershipResult> {
  return syncMembership(ctx);
}

/**
 * Phase-2 denormalized hydrate (design §Sync + hydrate, phase 2). Resolves the
 * loose context and delegates to the `internal/hydrate` orchestrator, which
 * fills the browse projection (sortTitle, year, genres, servers, qualityTiers,
 * watchedState, franchise) for the user's new and stale owned rows. Thin by
 * design: no drizzle, no fan-out logic here — `internal/hydrate` owns the
 * orchestration and `repo/hydrate` owns the SQL.
 *
 * The 6-hourly membership sync calls this after reconciling membership so freshly
 * inserted rows hydrate promptly; the hourly `library.hydrate` job calls it with
 * a 1-hour window to refresh availability staleness (availability moves faster
 * than membership).
 */
export async function hydrateLibrary(
  ctx: MaybeLibraryContext,
  opts?: HydrateOptions,
): Promise<HydrateResult> {
  return hydrate(asLibraryContext(ctx), opts ?? {});
}

/**
 * Returns the unfiltered facet totals for a user's owned library (design
 * §Facets), served behind a short-TTL per-user cache. The FE re-reads facets
 * whenever the popover re-opens or the rail re-renders, so the cache keeps that
 * off the GROUP-BY fan-out; the membership sync busts the entry on a real
 * change. Counts are whole-library totals, NOT filter-aware (matches the mock).
 *
 * Unlike the lens reads, this does NOT eager-seed: a brand-new user's facets are
 * empty until the lens read's `fetchRawSet` seeds membership (the watchlist
 * precedent — seed rides the primary list read, not every read), at which point
 * the sync busts this cache and the next `/facets` read reflects the seed.
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
 * Lists the user's owned franchises group-first (design §Collections lens).
 * Eager-seeds membership on a first read exactly as the lens path does (so a
 * brand-new user's collections are not empty on first paint), pages the owned
 * franchises via the repo keyset, then enriches each group's preview ids into
 * `CompactMediaItem`s through the SAME dedup-free enrich the lenses use — no
 * availability re-probe, reading the denormalized columns. Owned-only and
 * TV/standalone-excluded are enforced in SQL (`owned = true` +
 * `collection_id IS NOT NULL`); preview is capped at four in SQL. Thin by
 * design: no drizzle here — the repo owns the SQL, this orchestrates.
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
  const page = await selectCollections(c.userId, toFilters(query), decoded, query.limit);
  const previews = await enrichPreviews(c, page.groups);
  const collections = page.groups.map((group) => toLibraryCollection(group, previews));
  const cursor = page.nextGroup ? encodeCollectionsCursor(page.nextGroup) : null;
  return { collections, cursor };
}

/**
 * Enriches every group's preview ids in ONE batch into a `id → CompactMediaItem`
 * lookup. Pooling all groups' previews into a single `selectRowsByIds` +
 * `buildEnrichRows` call keeps the metadata/progress fan-out to one round trip
 * for the whole page rather than one per franchise. The enrich is the lens'
 * dedup-free builder, so it reads the denormalized `servers`/`qualityTiers`
 * columns and never re-probes availability.
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
 * Maps a repo group + the enriched preview lookup onto the wire
 * `LibraryCollection`. The preview keeps the repo's `(sortTitle, id)` ordering
 * (it walks `group.previewIds`, not the lookup) and drops any id the enrich
 * could not resolve, so a missing-metadata preview shrinks the fan rather than
 * surfacing a blank card.
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
 * Projects the parsed wire query onto the repo `LensFilters` shape, dropping
 * omitted axes so the repo applies no filter for them. Mirrors the item lenses'
 * `toLensParams` so the filter axes behave identically across every lens.
 */
function toFilters(query: LibraryCollectionsQueryParsed): LensFilters {
  const filters: LensFilters = {};
  if (query.kinds) filters.kinds = query.kinds;
  if (query.genres) filters.genres = query.genres;
  if (query.qualities) filters.qualities = query.qualities;
  if (query.servers) filters.servers = query.servers;
  if (query.watched) filters.watched = query.watched;
  return filters;
}

/**
 * Fetches the `collection@v1` feed and parses it into insertable new rows plus
 * the full set of feed keys. A feed error (terminal all-providers failure) is
 * swallowed at this boundary: it logs at info severity and reports an empty,
 * `partial` feed so the sync no-ops rather than throwing — the run still
 * surfaces the degradation via `partial`, and a later sync self-heals.
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
