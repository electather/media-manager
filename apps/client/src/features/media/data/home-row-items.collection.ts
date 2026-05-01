import { createCollection, localOnlyCollectionOptions } from "@tanstack/react-db";
import type { RowKind } from "@ent-mcp/shared/home";

/**
 * Reference rows that link a `(rowId, cursor, position)` tuple to a media id.
 * Populated by `loadRowPage` after each `home.getRowContent` call. The
 * composite id is keyed by cursor (V18) — using a page-number would make
 * pre-cursor entries stale-collide on cursor advancement.
 */
export interface HomeRowItem {
  id: string;
  rowId: RowKind;
  mediaId: string;
  position: number;
  cursor: string | null;
}

export function homeRowItemId(rowId: RowKind, cursor: string | null, position: number): string {
  return `${rowId}:${cursor ?? "first"}:${position}`;
}

export const homeRowItemsCollection = createCollection(
  localOnlyCollectionOptions<HomeRowItem>({
    id: "home.rowItems",
    getKey: (row) => row.id,
  }),
);
