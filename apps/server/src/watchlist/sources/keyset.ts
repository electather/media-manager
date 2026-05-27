import type { ActiveRow } from "@ent-mcp/shared/media";
import type { Cursor, RawPageToken } from "../../media";

/**
 * The watchlist keyset hop token codec shared by every keyset `MediaSource`
 * (items, mood-items). The opaque `k` carried by a keyset {@link Cursor} is the
 * `"addedAt:id"` resume position; the source decodes the incoming cursor with
 * {@link decodeKeyset} and threads the next page's position back as a
 * {@link RawPageToken} via {@link rawToken}, which `media.paginate` mints into
 * the next cursor.
 */

/** Parse the keyset cursor's opaque `k` (`"addedAt:id"`) back to a page cursor. */
// fallow-ignore-next-line complexity
export function decodeKeyset(cursor: Cursor | null): { addedAt: number; id: string } | undefined {
  if (!cursor || cursor.mode !== "keyset") return undefined;
  const sep = cursor.k.indexOf(":");
  if (sep < 0) return undefined;
  const addedAt = Number(cursor.k.slice(0, sep));
  const id = cursor.k.slice(sep + 1);
  if (!Number.isFinite(addedAt) || id.length === 0) return undefined;
  return { addedAt, id };
}

/** The keyset hop token the pipeline mints the next cursor from. */
export function rawToken(row: ActiveRow): RawPageToken {
  return `${row.addedAt}:${row.id}`;
}
