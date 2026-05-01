import type { MediaDetail } from "./types";

/**
 * Subset of `MediaDetail` that travels on home-feed wire payloads. Field set
 * is the contract source — `home.*` procedures emit exactly these keys, and
 * the client treats received compact rows as `Partial<MediaDetail>` with
 * detail-only fields filled in later via `media.get`.
 */
export const COMPACT_FIELDS = [
  "id",
  "tmdbId",
  "mediaType",
  "title",
  "year",
  "poster",
  "backdrop",
  "clearLogo",
  "overview",
  "genres",
  "rating",
  "userRating",
  "matchReason",
  "status",
  "progress",
  "episodeProgress",
  "episode",
] as const;

export type CompactMediaItem = Pick<MediaDetail, (typeof COMPACT_FIELDS)[number]>;

/**
 * Runtime projection from `MediaDetail` to `CompactMediaItem`. `@ent-mcp/shared`
 * has no runtime deps beyond `zod` (V12), so the pick is inlined rather than
 * delegated to `es-toolkit`.
 */
export function toCompact(detail: MediaDetail): CompactMediaItem {
  const out: Partial<CompactMediaItem> = {};
  for (const key of COMPACT_FIELDS) {
    const value = detail[key];
    if (value !== undefined) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out as CompactMediaItem;
}
