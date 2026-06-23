import type { CollectionCursor } from "../repo";

/**
 * Opaque keyset cursor codec for group-first Collections endpoint (not via media
 * `paginate`). Token packs `"<collectionName> <collectionId>"`, split on LAST
 * space: `collectionId` (numeric) never has spaces, but `collectionName` can, so
 * prefix is name, suffix is id. `decodeCollectionsCursor` is total: null/empty/
 * malformed returns `undefined` (service reads as "first page", no 400).
 */
export function encodeCollectionsCursor(cursor: CollectionCursor): string {
  return `${cursor.collectionName} ${cursor.collectionId}`;
}

/** Decodes a collections cursor back to its `(collectionName, collectionId)` resume position, or undefined. */
export function decodeCollectionsCursor(token: string | undefined): CollectionCursor | undefined {
  if (!token) return undefined;
  const sep = token.lastIndexOf(" ");
  if (sep < 0) return undefined;
  const collectionName = token.slice(0, sep);
  const collectionId = token.slice(sep + 1);
  if (collectionId.length === 0) return undefined;
  return { collectionName, collectionId };
}
