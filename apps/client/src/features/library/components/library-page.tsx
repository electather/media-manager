import { useCallback, useMemo, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { MediaDetailModal } from "@/shared/components/media-detail-modal";
import { splitCompositeId } from "@/shared/lib/media-id";
import { bucketize, deriveCounts } from "../lib/classify";
import { LIBRARY_ITEMS, LIBRARY_ITEM_INDEX, LIBRARY_MOODS } from "../lib/mock-data";
import type { LibraryFilter, LibraryItem, LibraryMoodGroup, LibrarySort } from "../lib/types";
import { Awaiting } from "./awaiting";
import { ComingUp } from "./coming-up";
import { LibraryFilteredGrid } from "./library-filtered-grid";
import { LibraryHeader } from "./library-header";
import { MoodMosaic } from "./mood-mosaic";
import { ReadyRow } from "./ready-row";
import { RecentlyAdded } from "./recently-added";
import { TonightPick } from "./tonight-pick";

type PeekSearch = { peek?: string };

function selectFiltered(
  filter: LibraryFilter,
  items: readonly LibraryItem[],
  buckets: ReturnType<typeof bucketize>,
): readonly LibraryItem[] {
  if (filter === "ready") return [...buckets.available, ...buckets.inProgress];
  if (filter === "in-progress") return buckets.inProgress;
  if (filter === "awaiting") return [...buckets.requested, ...buckets.unavailable];
  if (filter === "upcoming") return buckets.upcoming;
  return items;
}

function applySort(items: readonly LibraryItem[], sort: LibrarySort): LibraryItem[] {
  const xs = items.slice();
  if (sort === "alpha") xs.sort((a, b) => a.title.localeCompare(b.title));
  else if (sort === "runtime") {
    xs.sort((a, b) => (a.facets?.runtimeMin ?? 999) - (b.facets?.runtimeMin ?? 999));
  }
  return xs;
}

/**
 * Editorial library/watchlist page ported from the nama prototype. v1 ships
 * with mock data — the API surface (curated picks, mood clusters, recent log)
 * lands in a follow-up. The peek modal still flows through the route's
 * `?peek=` search param so deep links work, mirroring the home feed.
 */
export function LibraryPage() {
  const items = LIBRARY_ITEMS;
  const navigate = useNavigate();
  const { peek } = useSearch({ strict: false }) as PeekSearch;

  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [sort, setSort] = useState<LibrarySort>("recent");
  const [watchlist, setWatchlist] = useState<ReadonlySet<string>>(() => new Set());

  const buckets = useMemo(() => bucketize(items), [items]);
  const counts = useMemo(() => deriveCounts(buckets), [buckets]);

  const tonight = useMemo<LibraryItem | null>(() => {
    const candidates = [...buckets.available, ...buckets.inProgress];
    return candidates.find((i) => i.clearLogoText) ?? candidates[0] ?? items[0] ?? null;
  }, [buckets, items]);

  const alternates = useMemo<LibraryItem[]>(() => {
    if (!tonight) return [];
    return [...buckets.available, ...buckets.inProgress]
      .filter((i) => i.id !== tonight.id)
      .slice(0, 4);
  }, [buckets, tonight]);

  const moodGroups = useMemo<LibraryMoodGroup[]>(
    () =>
      LIBRARY_MOODS.map((mood) => ({
        mood,
        items: mood.itemIds
          .map((id) => LIBRARY_ITEM_INDEX.get(id))
          .filter((i): i is LibraryItem => Boolean(i)),
      })),
    [],
  );

  const filtered = useMemo(
    () => applySort(selectFiltered(filter, items, buckets), sort),
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

  const peekItem = peek ? (LIBRARY_ITEM_INDEX.get(peek) ?? null) : null;
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
      <LibraryHeader
        items={items}
        counts={counts}
        filter={filter}
        sort={sort}
        onFilterChange={setFilter}
        onSortChange={setSort}
      />
      <div className="pb-32">
        {filterActive ? (
          <LibraryFilteredGrid items={filtered} filter={filter} sort={sort} onPeek={handlePeek} />
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
