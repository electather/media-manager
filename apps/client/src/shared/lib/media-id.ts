/** Composite IDs ("movie:slug" / "tv:slug") are the wire format for `CompactMediaItem`.
 *  Single source of truth for parsing across home feed, detail page, peek modal.
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

/** Canonical detail-page URL for a composite id. Returns null if unparseable so callers
 *  omit `href` rather than render broken links; supports middle-click / cmd-click.
 */
export function buildMediaHref(compositeId: string): string | null {
  const parts = splitCompositeId(compositeId);
  if (!parts) return null;
  return `/media/${parts.mediaType}/${parts.mediaId}`;
}
