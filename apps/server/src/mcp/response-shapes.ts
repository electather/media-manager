import { z } from "zod";
import type { MediaItemShape } from "@ent-mcp/plugin-sdk";

const availabilityStatusSchema = z.enum([
  "available",
  "requested",
  "processing",
  "unavailable",
  "unknown",
]);

export type AvailabilityStatus = z.infer<typeof availabilityStatusSchema>;

/** Compact agent-facing item. Absent fields are omitted, never null. */
export const compactMediaResultSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: z.enum(["movie", "tv"]),
  year: z.number().int().optional(),
  genres: z.array(z.string()).optional(),
  rating: z.number().optional(),
  overview: z.string().optional(),
  poster: z.string().optional(),
  status: availabilityStatusSchema.optional(),
  user_rated: z.number().int().optional(),
  match_reason: z.string().optional(),
});

export type CompactMediaResult = z.infer<typeof compactMediaResultSchema>;

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

function resolveSource(input: unknown): Partial<MediaItemShape> {
  const wrapper = input as { item?: unknown } | null | undefined;
  if (looksLikeMediaItem(wrapper?.item)) return wrapper!.item as Partial<MediaItemShape>;
  if (looksLikeMediaItem(input)) return input as Partial<MediaItemShape>;
  return {};
}

function applySourceFields(out: CompactMediaResult, source: Partial<MediaItemShape>): void {
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
}

function applyShapeOptions(out: CompactMediaResult, options: ShapeOptions): void {
  if (options.status && options.status !== "unknown") out.status = options.status;
  if (typeof options.userRated === "number" && options.userRated > 0)
    out.user_rated = options.userRated;
  if (typeof options.matchReason === "string" && options.matchReason.length > 0)
    out.match_reason = options.matchReason;
}

/**
 * Normalizes an arbitrary plugin-shaped MediaItem (or wrapper with `item`)
 * into the compact surface. Drops null/empty fields so they do not waste
 * tokens in the agent's context window.
 */
export function compactMediaItem(input: unknown, options: ShapeOptions = {}): CompactMediaResult {
  const source = resolveSource(input);
  const out: CompactMediaResult = {
    id: String(source.id ?? ""),
    title: String(source.title ?? ""),
    type: (source.type as "movie" | "tv") ?? "movie",
  };
  applySourceFields(out, source);
  applyShapeOptions(out, options);
  return out;
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
