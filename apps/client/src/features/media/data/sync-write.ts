import { omitBy } from "es-toolkit/object";
import { isNil } from "es-toolkit/predicate";
import type { CompactMediaItem } from "@ent-mcp/shared/home";
import type { MediaDetail } from "@ent-mcp/shared/media";
import { mediaCollection, type MediaRow } from "./media.collection";

/**
 * Merges a compact wire row into the entity collection. Detail-only fields
 * on an existing full row are preserved; `omitBy(isNil)` strips undefined
 * compact fields so they cannot nuke richer values (V79).
 */
export function writeCompactToMedia(item: CompactMediaItem): void {
  const stripped = omitBy(item as Record<string, unknown>, isNil) as Partial<MediaDetail>;
  const existing = mediaCollection.get(item.id);
  if (existing) {
    mediaCollection.utils.writeUpdate({
      ...existing,
      ...stripped,
      id: item.id,
    });
    return;
  }
  mediaCollection.utils.writeInsert({
    ...(stripped as MediaDetail),
    id: item.id,
    _detailFetchedAt: null,
  });
}

/**
 * Stamps a fully-fetched detail row into the entity collection. Always sets
 * `_detailFetchedAt` to the current wall-clock (V80).
 */
export function writeFullToMedia(detail: MediaDetail): void {
  const row: MediaRow = { ...detail, _detailFetchedAt: Date.now() };
  const existing = mediaCollection.get(detail.id);
  if (existing) {
    mediaCollection.utils.writeUpdate(row);
    return;
  }
  mediaCollection.utils.writeInsert(row);
}
