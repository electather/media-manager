import type { CollectionCursor } from "../repo";

/**
 * Keyset cursor: `"<collectionName> <collectionId>"` split on LAST space
 * (name can have spaces, id cannot). `decodeCollectionsCursor` is total: returns undefined on null/empty/malformed.
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
