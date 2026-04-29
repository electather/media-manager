/** Shared parsing utilities for raw plugin item payloads. */

export interface RawPluginItem {
  ids?: { tmdb_id?: string };
  id?: string;
  type?: "movie" | "tv";
}

export interface ItemIdentity {
  tmdbId: string;
  type: "movie" | "tv";
}

/** Resolves a tmdbId + media type from a raw plugin item, or null if unresolvable. */
export function identifyItem(item: RawPluginItem | undefined): ItemIdentity | null {
  if (!item) return null;
  const tmdbId = item.ids?.tmdb_id ?? splitCombinedId(item.id)?.id;
  const type = item.type ?? splitCombinedId(item.id)?.type;
  if (!tmdbId || (type !== "movie" && type !== "tv")) return null;
  return { tmdbId, type };
}

/** Splits a `"movie:550"` combined id into its type and id parts. */
export function splitCombinedId(
  combined: string | undefined,
): { type: "movie" | "tv"; id: string } | null {
  if (!combined) return null;
  const [type, id] = combined.split(":");
  if ((type !== "movie" && type !== "tv") || !id) return null;
  return { type, id };
}

/** Parses an ISO date string into a millisecond timestamp, or null if invalid. */
export function parseItemDate(raw: string | undefined): number | null {
  if (!raw) return null;
  const ts = Date.parse(raw);
  return Number.isFinite(ts) ? ts : null;
}

/**
 * Validates the identity and timestamp fields common to every history-like
 * entry. Returns the resolved base fields, or null if either field is absent
 * or unparseable.
 */
export function parseHistoryBase(entry: {
  item?: RawPluginItem;
  watchedAt?: string;
}): { tmdbId: string; mediaType: "movie" | "tv"; watchedAt: number } | null {
  const identity = identifyItem(entry.item);
  if (!identity) return null;
  const watchedAt = parseItemDate(entry.watchedAt);
  if (watchedAt === null) return null;
  return { tmdbId: identity.tmdbId, mediaType: identity.type, watchedAt };
}
