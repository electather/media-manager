import type { AzCursor, QualityCursor, ServerCursor, TimelineCursor } from "../repo";
import { rankQualityTier } from "../internal/rank-quality";
import type { ExpandedLibraryRow, LibraryRow } from "../types";
import type { Cursor, RawPageToken } from "../../media";

/**
 * Per-lens keyset hop-token codecs, mirroring `watchlist/sources/keyset.ts`. The
 * opaque `k` a keyset {@link Cursor} carries is the lens's resume position; the
 * source decodes the incoming cursor with the matching `decode*` and threads the
 * next page's position back as a {@link RawPageToken} via the matching `*Token`,
 * which `media.paginate` mints into the next cursor.
 *
 * The token packs `<sortKey> <id>` joined on a single space. The library `id`
 * (`"movie:550"`) never contains a space, but a `sortTitle` can, so every decode
 * splits on the LAST space to recover the id and treats the prefix as the sort
 * key. Like watchlist, every `decode*` is total — a bad, foreign, or
 * non-keyset cursor returns `undefined`, which the source reads as "first page"
 * and NEVER throws (invariant: a hand-edited cursor degrades, never 400s).
 */

/** A–Z hop token: `"<sortTitle> <id>"`. */
export function azToken(row: LibraryRow): RawPageToken {
  return `${row.sortTitle} ${row.id}`;
}

/** Timeline hop token: `"<year ?? 0> <id>"` — undated rows page as year 0. */
export function timelineToken(row: LibraryRow): RawPageToken {
  return `${row.year ?? 0} ${row.id}`;
}

/** Decode an A–Z cursor back to its `(sortTitle, id)` resume position, or undefined. */
export function decodeAz(cursor: Cursor | null): AzCursor | undefined {
  const parts = splitToken(cursor);
  if (!parts) return undefined;
  return { sortTitle: parts.head, id: parts.id };
}

/**
 * Decode a Timeline cursor back to its `(year, id)` resume position, or
 * undefined. The year must parse to a finite integer; anything else (a
 * hand-edited token) takes the first-page path rather than flowing a `NaN` into
 * the keyset comparison.
 */
export function decodeTimeline(cursor: Cursor | null): TimelineCursor | undefined {
  const parts = splitToken(cursor);
  if (!parts) return undefined;
  const year = Number(parts.head);
  if (!Number.isFinite(year)) return undefined;
  return { year, id: parts.id };
}

/**
 * Server hop token: `"<sectionId> <sortTitle> <id>"`. The leading section is the
 * server connection id (the `json_each` value's `id`), which never contains a
 * space; the trailing `id` is the composite library id, also space-free; only
 * the middle `sortTitle` can contain spaces, so the decode peels the first and
 * last spaces off (see {@link splitTriToken}).
 */
export function serverToken(row: ExpandedLibraryRow): RawPageToken {
  return `${row.section.id} ${row.sortTitle} ${row.id}`;
}

/**
 * Quality hop token: `"<tierRank> <sortTitle> <id>"`. The rank is the EXACT
 * `QUALITY_TIERS` ordinal the SQL `CASE` produced — taken from the expanded
 * row's `rank` when present, else re-derived from the tier label via
 * `rankQualityTier` (the two agree value-for-value by construction). Encoding the
 * ordinal, not the label, keeps the token comparable to the cursor predicate's
 * numeric rank.
 */
export function qualityToken(row: ExpandedLibraryRow): RawPageToken {
  const rank = row.rank ?? rankQualityTier(row.section.id);
  return `${rank} ${row.sortTitle} ${row.id}`;
}

/**
 * Decode a Server cursor back to its `(sectionId, sortTitle, id)` resume
 * position, or undefined for any bad/foreign/non-keyset cursor (→ first page,
 * never throws).
 */
export function decodeServer(cursor: Cursor | null): ServerCursor | undefined {
  const parts = splitTriToken(cursor);
  if (!parts) return undefined;
  return { sectionId: parts.head, sortTitle: parts.mid, id: parts.id };
}

/**
 * Decode a Quality cursor back to its `(tierRank, sortTitle, id)` resume
 * position, or undefined. The rank must parse to a finite integer; a hand-edited
 * non-numeric rank takes the first-page path rather than flowing `NaN` into the
 * keyset comparison.
 */
export function decodeQuality(cursor: Cursor | null): QualityCursor | undefined {
  const parts = splitTriToken(cursor);
  if (!parts) return undefined;
  const tierRank = Number(parts.head);
  if (!Number.isFinite(tierRank)) return undefined;
  return { tierRank, sortTitle: parts.mid, id: parts.id };
}

/**
 * Pull the keyset `k` off a cursor and split it on the LAST space into the sort
 * key prefix (`head`) and the trailing composite `id`. Returns undefined for a
 * null/non-keyset cursor, a token with no space, or an empty id — every
 * bad-cursor path the `decode*` functions fold into "first page".
 */
function splitToken(cursor: Cursor | null): { head: string; id: string } | undefined {
  if (!cursor || cursor.mode !== "keyset") return undefined;
  const sep = cursor.k.lastIndexOf(" ");
  if (sep < 0) return undefined;
  const head = cursor.k.slice(0, sep);
  const id = cursor.k.slice(sep + 1);
  if (id.length === 0) return undefined;
  return { head, id };
}

/**
 * Split a three-part grouped-lens token `"<head> <mid> <id>"` into its leading
 * section/rank key (`head`), the middle `sortTitle` (`mid`, the only part that
 * may contain spaces), and the trailing composite `id`. The split peels the
 * FIRST space (head) and the LAST space (id); whatever lies between is the sort
 * title. Returns undefined for a null/non-keyset cursor, fewer than three parts,
 * or an empty id — every bad-cursor path the grouped `decode*` functions fold
 * into "first page", never a throw.
 */
function splitTriToken(
  cursor: Cursor | null,
): { head: string; mid: string; id: string } | undefined {
  if (!cursor || cursor.mode !== "keyset") return undefined;
  const first = cursor.k.indexOf(" ");
  const last = cursor.k.lastIndexOf(" ");
  // Need two distinct separators: a single space would mean only two parts.
  if (first < 0 || first === last) return undefined;
  const head = cursor.k.slice(0, first);
  const mid = cursor.k.slice(first + 1, last);
  const id = cursor.k.slice(last + 1);
  if (id.length === 0) return undefined;
  return { head, mid, id };
}
