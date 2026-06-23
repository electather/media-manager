import type { ActiveRow } from "@nama/shared/media";
import type { Cursor, RawPageToken } from "../../media";

// Keyset hop token codec shared by every keyset MediaSource (items, mood-items). Opaque `k` is "addedAt:id" resume position. Source decodes cursor with decodeKeyset, threads next page back as RawPageToken via rawToken, which media.paginate mints into next cursor.

/** Parse the keyset cursor's opaque `k` (`"addedAt:id"`) back to a page cursor. */
// fallow-ignore-next-line complexity
export function decodeKeyset(cursor: Cursor | null): { addedAt: number; id: string } | undefined {
  if (!cursor || cursor.mode !== "keyset") return undefined;
  const sep = cursor.k.indexOf(":");
  if (sep < 0) return undefined;
  const addedAt = Number(cursor.k.slice(0, sep));
  const id = cursor.k.slice(sep + 1);
  // `addedAt` is a Date.now() epoch on the wire, so a negative value cannot
  // identify any real row. Reject it explicitly — `Number.isFinite(-1)` is
  // `true`, which would otherwise let the cursor flow into the DB query and
  // return a silently-empty page instead of taking the bad-cursor path.
  if (!Number.isFinite(addedAt) || addedAt < 0 || id.length === 0) return undefined;
  return { addedAt, id };
}

/** The keyset hop token the pipeline mints the next cursor from. */
export function rawToken(row: ActiveRow): RawPageToken {
  return `${row.addedAt}:${row.id}`;
}
