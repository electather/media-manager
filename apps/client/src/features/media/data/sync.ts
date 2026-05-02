import type { RowContentResponse, RowKind } from "@ent-mcp/shared/home";
import type { MediaDetail } from "@ent-mcp/shared/media";
import { api } from "@/shared/lib/api";
import { queryClient } from "@/shared/lib/db";
import {
  homeLayoutCollection,
  HOME_LAYOUT_QUERY_KEY,
  type HomeLayoutRow,
} from "./home-layout.collection";
import {
  homeRowItemId,
  homeRowItemsCollection,
  type HomeRowItem,
} from "./home-row-items.collection";
import { writeCompactToMedia, writeFullToMedia } from "./sync-write";

export const DETAIL_TTL_MS = 60 * 60 * 1000;

export { writeCompactToMedia, writeFullToMedia } from "./sync-write";

/**
 * Splits a `home.getRowContent` response into entity writes (media first per
 * V86), reference writes (homeRowItems second), then a `setQueryData`-driven
 * cursor advance so the next `loadRowPage` reads the new cursor (V89).
 */
export function splitRowContent(
  rowId: RowKind,
  cursorUsed: string | null,
  res: RowContentResponse,
): void {
  for (const item of res.items) {
    writeCompactToMedia(item);
  }
  res.items.forEach((item, position) => {
    const ref: HomeRowItem = {
      id: homeRowItemId(rowId, cursorUsed, position),
      rowId,
      mediaId: item.id,
      position,
      cursor: cursorUsed,
    };
    const existing = homeRowItemsCollection.get(ref.id);
    if (existing) {
      homeRowItemsCollection.update(ref.id, (draft) => {
        Object.assign(draft, ref);
      });
    } else {
      homeRowItemsCollection.insert(ref);
    }
  });

  queryClient.setQueryData<HomeLayoutRow[]>([...HOME_LAYOUT_QUERY_KEY], (prev) => {
    if (!prev || prev.length === 0) return prev;
    return prev.map((layout) => ({
      ...layout,
      rows: layout.rows.map((row) =>
        row.rowId === rowId ? { ...row, initialCursor: res.cursor } : row,
      ),
    }));
  });
}

/**
 * Loads the next page for a row using the cursor pinned in `homeLayout`.
 * Idempotent on already-loaded pages — callers may invoke after every
 * scroll-to-end. Skips when no cursor is available (row exhausted).
 */
export async function loadRowPage(rowId: RowKind): Promise<void> {
  const layout = homeLayoutCollection.get("current");
  const row = layout?.rows.find((r) => r.rowId === rowId);
  const cursor = row?.initialCursor ?? null;
  const res = await api.home.getRowContent.$post({ json: { rowId, cursor } });
  if (!res.ok) throw new Error(`home.getRowContent failed for ${rowId}`);
  const data = (await res.json()) as RowContentResponse;
  splitRowContent(rowId, cursor, data);
}

/**
 * Detail-fetch dedup. `queryClient.fetchQuery` keyed by media id ensures only
 * one in-flight RPC for the same id (V81); `staleTime` caps the cached
 * detail at the TTL (V14, V87). On success the entity collection is updated
 * via `writeFullToMedia`.
 */
export async function ensureDetail(id: string): Promise<MediaDetail | null> {
  const detail = await queryClient.fetchQuery<MediaDetail | null>({
    queryKey: ["media", "detail", id],
    staleTime: DETAIL_TTL_MS,
    queryFn: async () => {
      const res = await api.media.get.$post({ json: { id } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`media.get failed for ${id}`);
      return (await res.json()) as MediaDetail;
    },
  });
  if (detail) writeFullToMedia(detail);
  return detail;
}
