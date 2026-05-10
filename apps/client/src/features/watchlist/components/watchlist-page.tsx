import { useCallback, useMemo, useState } from "react";
import { MediaDetailModal, type MediaDetailItem } from "@/shared/components/media-detail-modal";
import { bucketize, countsFor } from "../lib/classify";
import { filterItems, sortItems } from "../lib/filter-sort";
import {
  listMockMoodGroups,
  listMockRecentLog,
  listMockUpcoming,
  listMockWatchlist,
} from "../lib/mock-data";
import type { WatchlistFilter, WatchlistItem, WatchlistSort } from "../lib/types";
import { Awaiting } from "./awaiting";
import { ComingUp } from "./coming-up";
import { FilteredView } from "./filtered-view";
import { MoodMosaic } from "./mood-mosaic";
import { ReadyRow } from "./ready-row";
import { RecentlyAdded } from "./recently-added";
import { TonightPick } from "./tonight-pick";
import { WatchlistHeader } from "./watchlist-header";

/**
 * Editorial watchlist orchestrator. Owns the filter / sort / peek state and
 * fans out pre-bucketed slices to each section. Mock-data only for now —
 * real fetchers replace `listMock*` once the backend ships a watchlist API.
 */
export function WatchlistPage() {
  const items = useMemo(() => listMockWatchlist(), []);
  const moodGroups = useMemo(() => listMockMoodGroups(), []);
  const upcomingMock = useMemo(() => listMockUpcoming(), []);
  const recentLog = useMemo(() => listMockRecentLog(), []);

  const [filter, setFilter] = useState<WatchlistFilter>("all");
  const [sort, setSort] = useState<WatchlistSort>("recent");
  const [peekId, setPeekId] = useState<string | null>(null);
  const [watchlist, setWatchlist] = useState<Set<string>>(() => new Set(items.map((i) => i.id)));

  const buckets = useMemo(() => bucketize(items), [items]);
  const counts = useMemo(() => countsFor(buckets), [buckets]);

  const tonight = useMemo<WatchlistItem | null>(() => {
    const candidates = [...buckets.available, ...buckets.inProgress];
    return candidates.find((i) => i.clearLogoText) ?? candidates[0] ?? items[0] ?? null;
  }, [items, buckets]);

  const alternates = useMemo(() => {
    const tonightId = tonight?.id;
    return [...buckets.available, ...buckets.inProgress]
      .filter((i) => i.id !== tonightId)
      .slice(0, 4);
  }, [buckets, tonight]);

  const filtered = useMemo(
    () => sortItems(filterItems(items, buckets, upcomingMock, filter), sort),
    [items, buckets, upcomingMock, filter, sort],
  );

  const handlePeek = useCallback((id: string) => {
    setPeekId(id);
  }, []);

  const handleClose = useCallback(() => {
    setPeekId(null);
  }, []);

  const handleShuffle = useCallback(() => {
    const first = alternates[0];
    if (first) setPeekId(first.id);
  }, [alternates]);

  const handleRequestAll = useCallback(() => {
    // Request flow wiring lands with the real fetchers; the action exists
    // so the design read remains complete.
  }, []);

  const peekItem = useMemo<MediaDetailItem | null>(() => {
    if (!peekId) return null;
    const found = items.find((i) => i.id === peekId);
    return found ? (found as MediaDetailItem) : null;
  }, [peekId, items]);

  const inWatchlist = peekId ? watchlist.has(peekId) : false;
  const handleToggleWatchlist = useCallback(() => {
    if (!peekId) return;
    setWatchlist((prev) => {
      const next = new Set(prev);
      if (next.has(peekId)) next.delete(peekId);
      else next.add(peekId);
      return next;
    });
  }, [peekId]);

  const filterActive = filter !== "all";
  const upcomingForSection = buckets.upcoming.length > 0 ? buckets.upcoming : upcomingMock;
  const readyForSection = [...buckets.available, ...buckets.inProgress].filter(
    (i) => i.id !== tonight?.id,
  );

  return (
    <div className="mx-auto w-full max-w-400 px-4 sm:px-6 lg:px-8">
      <WatchlistHeader
        items={items}
        counts={counts}
        filter={filter}
        onFilterChange={setFilter}
        sort={sort}
        onSortChange={setSort}
      />
      <div className="pb-32">
        {filterActive ? (
          <FilteredView
            items={filtered}
            filter={filter as Exclude<WatchlistFilter, "all">}
            sort={sort}
            onPeek={handlePeek}
          />
        ) : (
          <>
            <TonightPick
              pick={tonight}
              alternates={alternates}
              onPeek={handlePeek}
              onShuffle={handleShuffle}
            />
            <ReadyRow items={readyForSection} onPeek={handlePeek} />
            <MoodMosaic moods={moodGroups} onPeek={handlePeek} />
            <ComingUp items={upcomingForSection} onPeek={handlePeek} />
            <Awaiting
              items={[...buckets.requested, ...buckets.unavailable]}
              onPeek={handlePeek}
              onRequestAll={handleRequestAll}
            />
            <RecentlyAdded entries={recentLog} onPeek={handlePeek} />
          </>
        )}
      </div>
      <MediaDetailModal
        item={peekItem}
        open={Boolean(peekId)}
        onClose={handleClose}
        inWatchlist={inWatchlist}
        onToggleWatchlist={handleToggleWatchlist}
      />
    </div>
  );
}
