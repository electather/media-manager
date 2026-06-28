import type { AzCursor, QualityCursor, ServerCursor, TimelineCursor } from "../repo";
import { rankQualityTier } from "@nama/shared/library";
import type { ExpandedLibraryRow, LibraryRow } from "../types";
import type { Cursor, RawPageToken } from "../../media";

/**
 * Per-lens keyset hop-token codecs, mirroring `watchlist/sources/keyset.ts`.
 * Token format `<sortKey> <id>` split on LAST space (library id and sortTitle can have spaces).
 * Every `decode*` is total — bad cursors return undefined (first page), never throw (invariant: hand-edited cursors degrade, never 400s).
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
 * Decode a Timeline cursor back to its `(year, id)` resume position, or undefined.
 * Year must parse to finite integer; hand-edited non-numeric tokens take first-page path, never NaN into keyset comparison.
 */
export function decodeTimeline(cursor: Cursor | null): TimelineCursor | undefined {
  const parts = splitToken(cursor);
  if (!parts) return undefined;
  const year = Number(parts.head);
  if (!Number.isFinite(year)) return undefined;
  return { year, id: parts.id };
}

/**
 * Server hop token: `"<sectionId> <sortTitle> <id>"`.
 * Only sortTitle can have spaces; decode splits first and last space off (see {@link splitTriToken}).
 */
export function serverToken(row: ExpandedLibraryRow): RawPageToken {
  return `${row.section.id} ${row.sortTitle} ${row.id}`;
}

/**
 * Quality hop token: `"<tierRank> <sortTitle> <id>"`.
 * Encodes `QUALITY_TIERS` ordinal (from row.rank or re-derived via rankQualityTier) so token stays comparable to numeric cursor predicates.
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
 * Decode a Quality cursor back to its `(tierRank, sortTitle, id)` resume position, or undefined.
 * Rank must parse to finite integer; hand-edited non-numeric rank takes first-page path, never NaN into keyset comparison.
 */
export function decodeQuality(cursor: Cursor | null): QualityCursor | undefined {
  const parts = splitTriToken(cursor);
  if (!parts) return undefined;
  const tierRank = Number(parts.head);
  if (!Number.isFinite(tierRank)) return undefined;
  return { tierRank, sortTitle: parts.mid, id: parts.id };
}

/**
 * Split keyset `k` on LAST space into sort key (`head`) and `id`.
 * Returns undefined for null/non-keyset cursor, missing space, or empty id — bad cursors fold to "first page".
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
 * Split three-part token `"<head> <mid> <id>"` by FIRST and LAST space.
 * Returns undefined for null/non-keyset cursor, <3 parts, or empty id — bad cursors fold to "first page", never throw.
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
