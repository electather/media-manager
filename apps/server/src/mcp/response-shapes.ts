import type { MediaItemShape } from "@ent-mcp/plugin-sdk";

export type AvailabilityStatus =
  | "available"
  | "requested"
  | "processing"
  | "unavailable"
  | "unknown";

/** Compact agent-facing item. Absent fields are omitted, never null. */
export interface CompactMediaResult {
  id: string;
  title: string;
  year?: number;
  type: "movie" | "tv";
  genres?: string[];
  rating?: number;
  overview?: string;
  poster?: string;
  status?: AvailabilityStatus;
  user_rated?: number;
  match_reason?: string;
}

interface ShapeOptions {
  status?: AvailabilityStatus;
  userRated?: number | null;
  matchReason?: string | null;
}

function looksLikeMediaItem(input: unknown): input is Partial<MediaItemShape> {
  if (!input || typeof input !== "object") return false;
  const rec = input as Record<string, unknown>;
  return typeof rec.id === "string" && typeof rec.title === "string";
}

/**
 * Normalizes an arbitrary plugin-shaped MediaItem (or wrapper with `item`)
 * into the compact surface. Drops null/empty fields so they do not waste
 * tokens in the agent's context window.
 */
export function compactMediaItem(input: unknown, options: ShapeOptions = {}): CompactMediaResult {
  const source = looksLikeMediaItem((input as { item?: unknown })?.item)
    ? ((input as { item: MediaItemShape }).item as Partial<MediaItemShape>)
    : looksLikeMediaItem(input)
      ? (input as Partial<MediaItemShape>)
      : ({} as Partial<MediaItemShape>);

  const out: CompactMediaResult = {
    id: String(source.id ?? ""),
    title: String(source.title ?? ""),
    type: (source.type as "movie" | "tv") ?? "movie",
  };
  if (typeof source.year === "number") out.year = source.year;
  if (Array.isArray(source.genres) && source.genres.length > 0)
    out.genres = source.genres.slice(0, 6);
  if (typeof source.rating === "number") out.rating = Math.round(source.rating * 10) / 10;
  if (typeof source.overview === "string" && source.overview.length > 0) {
    out.overview =
      source.overview.length > 400 ? `${source.overview.slice(0, 400)}…` : source.overview;
  }
  if (typeof source.posterUrl === "string" && source.posterUrl.length > 0)
    out.poster = source.posterUrl;
  if (options.status && options.status !== "unknown") out.status = options.status;
  if (typeof options.userRated === "number" && options.userRated > 0)
    out.user_rated = options.userRated;
  if (typeof options.matchReason === "string" && options.matchReason.length > 0) {
    out.match_reason = options.matchReason;
  }
  return out;
}

export interface DiscoverResponse {
  results: CompactMediaResult[];
  total: number;
  has_more: boolean;
}

/**
 * Assembles a `results` array from plugin dispatch output. Handles both plain
 * MediaItems and `{ item, score }` search-result wrappers transparently.
 */
export function compactList(
  input: unknown[],
  metaFor: (index: number, source: unknown) => ShapeOptions = () => ({}),
  limit?: number,
): CompactMediaResult[] {
  const cap = limit ?? input.length;
  const out: CompactMediaResult[] = [];
  for (let i = 0; i < input.length && out.length < cap; i += 1) {
    const row = input[i];
    const options = metaFor(i, row);
    const compact = compactMediaItem(row, options);
    if (compact.id) out.push(compact);
  }
  return out;
}

/** Top-3 cast and top-8 keyword truncation lives with the details handler. */
export function truncate<T>(arr: T[] | undefined, max: number): T[] {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, max);
}
