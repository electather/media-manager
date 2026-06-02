import type { CollectionCursor } from "../repo";

/**
 * Opaque keyset cursor codec for the group-first Collections endpoint. Unlike
 * the item lenses — which ride the media `paginate` stage's `Cursor` wrapper —
 * `/api/library/collections` does not flow through the media pipeline, so it
 * mints and parses its own cursor string here. The token packs
 * `"<collectionName> <collectionId>"` joined on a single space and is split on
 * the LAST space, mirroring the lens keyset codecs: the `collectionId` (a TMDB
 * numeric id) never contains a space, but a `collectionName` ("The Lord of the
 * Rings Collection") can, so the prefix is the name and the suffix is the id.
 *
 * `decodeCollectionsCursor` is total: a null, empty, or malformed token (a
 * hand-edited link) returns `undefined`, which the service reads as "first
 * page" and NEVER throws — the same degrade-don't-400 discipline the lens codecs
 * follow.
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
