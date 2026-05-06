/**
 * Composite media ids ("movie:slug" / "tv:slug") are the wire format used by
 * `CompactMediaItem`. These helpers are the single source of truth for
 * splitting and rebuilding them so the home feed, the detail page, and the
 * peek modal all parse the format identically.
 */

export type MediaType = "movie" | "tv";

export function buildCompositeId(mediaType: MediaType, mediaId: string): string {
  return `${mediaType}:${mediaId}`;
}

export function splitCompositeId(id: string): { mediaType: MediaType; mediaId: string } | null {
  const colon = id.indexOf(":");
  if (colon < 0) return null;
  const mediaType = id.slice(0, colon);
  const mediaId = id.slice(colon + 1);
  if ((mediaType !== "movie" && mediaType !== "tv") || !mediaId) return null;
  return { mediaType, mediaId };
}
