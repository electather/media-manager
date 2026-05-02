import { useEffect, useMemo } from "react";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { compact } from "es-toolkit/array";
import type { RowKind } from "@ent-mcp/shared/home";
import type { MediaDetail } from "@ent-mcp/shared/media";
import { mediaCollection, type MediaRow } from "./media.collection";
import { homeLayoutCollection, type HomeLayoutRow } from "./home-layout.collection";
import { homeRowItemsCollection } from "./home-row-items.collection";
import { ensureDetail, writeCompactToMedia } from "./sync";

/**
 * Reads the singleton home-layout row. `null` until the first
 * `home.getLayout` resolves (cold) or the persisted query rehydrates from
 * IDB (warm).
 */
export function useHomeLayout() {
  const live = useLiveQuery((q) => q.from({ layout: homeLayoutCollection }));
  const row = (live.data?.[0] as HomeLayoutRow | undefined) ?? null;
  // Stamp hero compact row into the entity collection so the hero card renders
  // without waiting for the first row-content fetch (V89). Done here rather
  // than inside the queryFn so a write error cannot reject the query.
  useEffect(() => {
    if (row?.hero) writeCompactToMedia(row.hero.item);
  }, [row?.hero]);
  return {
    layout: row,
    isLoading: !row && live.isLoading,
  };
}

/**
 * Live-joins reference rows for `rowId` against the entity collection in
 * position order (V82). Stale references — refs whose media is not yet in
 * the entity collection — are filtered via `compact()` (V86).
 */
export function useHomeRow(rowId: RowKind) {
  const refs = useLiveQuery(
    (q) => q.from({ ref: homeRowItemsCollection }).where(({ ref }) => eq(ref.rowId, rowId)),
    [rowId],
  );
  const entities = useLiveQuery((q) => q.from({ row: mediaCollection }));

  const items = useMemo(() => {
    const refRows = (refs.data ?? []) as Array<{ mediaId: string; position: number }>;
    const entityRows = (entities.data ?? []) as MediaRow[];
    const byId = new Map(entityRows.map((row) => [row.id, row]));
    const ordered = [...refRows].sort((a, b) => a.position - b.position);
    return compact(ordered.map((r) => byId.get(r.mediaId) ?? null));
  }, [refs.data, entities.data]);

  return {
    items,
    isLoading: refs.isLoading || entities.isLoading,
  };
}

/**
 * Reads a single entity row by id without firing a detail fetch. Use for
 * fast list-card lookups; pair with `useMediaDetail` for the full peek
 * pipeline.
 */
export function useMediaRow(id: string | null) {
  const live = useLiveQuery(
    (q) => (id ? q.from({ row: mediaCollection }).where(({ row }) => eq(row.id, id)) : null),
    [id],
  );
  return (live.data?.[0] as MediaRow | undefined) ?? null;
}

/**
 * Snappy peek (V83/V88). Returns the entity row immediately when present
 * (compact OR full), and triggers `ensureDetail` to fill missing fields.
 * `isHydrating` flags an in-flight detail RPC; `isFullyLoaded` flips after
 * the detail row stamps `_detailFetchedAt`.
 */
export function useMediaDetail(id: string | null) {
  const live = useLiveQuery(
    (q) => (id ? q.from({ row: mediaCollection }).where(({ row }) => eq(row.id, id)) : null),
    [id],
  );
  const item = (live.data?.[0] as MediaRow | undefined) ?? null;

  useEffect(() => {
    if (!id) return;
    void ensureDetail(id);
  }, [id]);

  const isFullyLoaded = !!item?._detailFetchedAt;
  const isHydrating = !!id && !isFullyLoaded;

  return {
    item: (item ?? null) as MediaDetail | null,
    isHydrating,
    isFullyLoaded,
  };
}
