import { useCallback, useMemo, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { MediaDetailModal } from "@/features/media-detail";
import { splitCompositeId } from "@/shared/lib/media-id";
import { bucketize, classifyStatus, deriveCounts } from "../lib/classify";
import { WATCHLIST_ITEMS, WATCHLIST_ITEM_INDEX, WATCHLIST_MOODS } from "../lib/mock-data";
import type {
  WatchlistFilter,
  WatchlistItem,
  WatchlistMoodGroup,
  WatchlistSort,
  WatchlistStatus,
} from "../lib/types";
import { Awaiting } from "./awaiting";
import { ComingUp } from "./coming-up";
import { WatchlistFilteredGrid } from "./watchlist-filtered-grid";
import { WatchlistHeader } from "./watchlist-header";
import { MoodMosaic } from "./mood-mosaic";
import { ReadyRow } from "./ready-row";
import { RecentlyAdded } from "./recently-added";
import { TonightPick } from "./tonight-pick";

type PeekSearch = { peek?: string };
type Buckets = ReturnType<typeof bucketize>;

const BUCKET_SELECTORS: Record<
  WatchlistFilter,
  (b: Buckets, items: readonly WatchlistItem[]) => readonly WatchlistItem[]
> = {
  all: (_b, items) => items,
  ready: (b) => [...b.available, ...b.inProgress],
  "in-progress": (b) => b.inProgress,
  awaiting: (b) => [...b.requested, ...b.unavailable],
  upcoming: (b) => b.upcoming,
};

const STATUS_PRIORITY: Record<WatchlistStatus, number> = {
  "in-progress": 0,
  available: 1,
  requested: 2,
  unavailable: 3,
  upcoming: 4,
  unknown: 5,
};

const SORT_COMPARATORS: Record<
  WatchlistSort,
  ((a: WatchlistItem, b: WatchlistItem) => number) | null
> = {
  recent: null,
  status: (a, b) => STATUS_PRIORITY[classifyStatus(a)] - STATUS_PRIORITY[classifyStatus(b)],
  alpha: (a, b) => a.title.localeCompare(b.title),
  // fallow-ignore-next-line complexity
  runtime: (a, b) => (a.facets?.runtimeMin ?? 999) - (b.facets?.runtimeMin ?? 999),
};

function applySort(items: readonly WatchlistItem[], sort: WatchlistSort): WatchlistItem[] {
  const cmp = SORT_COMPARATORS[sort];
  return cmp ? items.slice().sort(cmp) : items.slice();
}

/**
 * Editorial watchlist page ported from the nama prototype. v1 ships
 * with mock data — the API surface (curated picks, mood clusters, recent log)
 * lands in a follow-up. The peek modal still flows through the route's
 * `?peek=` search param so deep links work, mirroring the home feed.
 */
// fallow-ignore-next-line complexity
export function WatchlistPage() {
  const items = WATCHLIST_ITEMS;
  const navigate = useNavigate();
  const { peek } = useSearch({ strict: false }) as PeekSearch;

  const [filter, setFilter] = useState<WatchlistFilter>("all");
  const [sort, setSort] = useState<WatchlistSort>("recent");
  const [watchlist, setWatchlist] = useState<ReadonlySet<string>>(() => new Set());

  const buckets = useMemo(() => bucketize(items), [items]);
  const counts = useMemo(() => deriveCounts(buckets), [buckets]);

  const tonight = useMemo<WatchlistItem | null>(() => {
    const candidates = [...buckets.available, ...buckets.inProgress];
    return candidates.find((i) => i.clearLogoText) ?? candidates[0] ?? null;
  }, [buckets]);

  const alternates = useMemo<WatchlistItem[]>(() => {
    if (!tonight) return [];
    return [...buckets.available, ...buckets.inProgress]
      .filter((i) => i.id !== tonight.id)
      .slice(0, 4);
  }, [buckets, tonight]);

  const moodGroups = useMemo<WatchlistMoodGroup[]>(
    () =>
      WATCHLIST_MOODS.map((mood) => ({
        mood,
        items: mood.itemIds
          .map((id) => WATCHLIST_ITEM_INDEX.get(id))
          .filter((i): i is WatchlistItem => Boolean(i)),
      })),
    [],
  );

  const filtered = useMemo(
    () => applySort(BUCKET_SELECTORS[filter](buckets, items), sort),
    [filter, items, buckets, sort],
  );

  const handlePeek = useCallback(
    (id: string) => {
      void navigate({ to: ".", search: { peek: id }, replace: false, resetScroll: false });
    },
    [navigate],
  );

  const handleClose = useCallback(() => {
    void navigate({ to: ".", search: {}, replace: false, resetScroll: false });
  }, [navigate]);

  const handleViewFullPage = useCallback(() => {
    if (!peek) return;
    const parts = splitCompositeId(peek);
    if (!parts) return;
    void navigate({ to: "/media/$mediaType/$mediaId", params: parts });
  }, [navigate, peek]);

  const peekItem = peek ? (WATCHLIST_ITEM_INDEX.get(peek) ?? null) : null;
  const inWatchlist = peek ? watchlist.has(peek) : false;
  const handleToggleWatchlist = useCallback(() => {
    if (!peek) return;
    setWatchlist((prev) => {
      const next = new Set(prev);
      if (next.has(peek)) next.delete(peek);
      else next.add(peek);
      return next;
    });
  }, [peek]);

  const readyForRow = useMemo(
    () =>
      [...buckets.available, ...buckets.inProgress].filter((i) => !tonight || i.id !== tonight.id),
    [buckets, tonight],
  );
  const awaitingItems = useMemo(() => [...buckets.requested, ...buckets.unavailable], [buckets]);

  const filterActive = filter !== "all";

  return (
    <main className="mx-auto w-full max-w-[100rem] px-4 sm:px-6 lg:px-8">
      <WatchlistHeader
        items={items}
        counts={counts}
        filter={filter}
        sort={sort}
        onFilterChange={setFilter}
        onSortChange={setSort}
      />
      <div className="pb-32">
        {filterActive ? (
          <WatchlistFilteredGrid items={filtered} filter={filter} sort={sort} onPeek={handlePeek} />
        ) : (
          <>
            {tonight ? (
              <TonightPick pick={tonight} alternates={alternates} onPeek={handlePeek} />
            ) : null}
            <ReadyRow items={readyForRow} onPeek={handlePeek} />
            <MoodMosaic groups={moodGroups} onPeek={handlePeek} />
            <ComingUp items={buckets.upcoming} onPeek={handlePeek} />
            <Awaiting items={awaitingItems} onPeek={handlePeek} />
            <RecentlyAdded onPeek={handlePeek} />
          </>
        )}
      </div>

      <MediaDetailModal
        item={peekItem}
        open={Boolean(peek)}
        onClose={handleClose}
        inWatchlist={inWatchlist}
        onToggleWatchlist={handleToggleWatchlist}
        onViewFullPage={handleViewFullPage}
      />
    </main>
  );
}
