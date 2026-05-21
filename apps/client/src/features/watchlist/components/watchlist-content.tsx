import { useCallback, useDeferredValue, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import * as m from "@/paraglide/messages";
import type { MediaType } from "@ent-mcp/shared/media";
import type { WatchlistListFilter } from "@ent-mcp/shared/watchlist";
import { MediaDetailModal, type MediaDetailItem } from "@/features/media-detail";
import { useHomeDetails } from "@/features/home/hooks/use-home-details";
import { splitCompositeId } from "@/shared/lib/media-id";
import { VirtualWindowList } from "@/shared/components/virtualized";
import { Button } from "@/shared/ui/button";
import { bucketize, classifyStatus } from "../lib/classify";
import { deriveMoods } from "../lib/derive-moods";
import { SECTION_HEIGHT_PX, type WatchlistSectionKind } from "../lib/section-heights";
import { useWatchlistItems } from "../hooks/use-watchlist-items";
import { useWatchlistCounts } from "../hooks/use-watchlist-counts";
import { useAddToWatchlist } from "../hooks/use-add-to-watchlist";
import { useRemoveFromWatchlist } from "../hooks/use-remove-from-watchlist";
import { useIsInWatchlist } from "../hooks/use-is-in-watchlist";
import type { WatchlistFilter, WatchlistItem, WatchlistSort, WatchlistStatus } from "../lib/types";
import { Awaiting } from "./awaiting";
import { ComingUp } from "./coming-up";
import { WatchlistFilteredGrid } from "./watchlist-filtered-grid";
import { WatchlistHeader } from "./watchlist-header";
import { MoodMosaic } from "./mood-mosaic";
import { ReadyRow } from "./ready-row";
import { RecentlyAdded } from "./recently-added";
import { TonightPick } from "./tonight-pick";

interface WatchlistSection {
  kind: WatchlistSectionKind;
  node: ReactNode;
}

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
  recent: (a, b) => b.addedAt - a.addedAt,
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
 * Maps the UI filter chips to the wire-side bucket the server understands.
 * `all` skips the filter entirely; `in-progress` collapses into `ready` on
 * the wire because the server doesn't distinguish in-progress items in the
 * paginated list (it's a client-only refinement off `progress`).
 */
function toListFilter(filter: WatchlistFilter): WatchlistListFilter | undefined {
  if (filter === "all") return undefined;
  if (filter === "in-progress") return "ready";
  return filter;
}

// fallow-ignore-next-line complexity
export function WatchlistContent() {
  const navigate = useNavigate();
  const { peek: rawPeek } = useSearch({ strict: false }) as PeekSearch;
  // Defer so peek-derived values coalesce across the concurrent scheduler during rapid back/forward navigation.
  const peek = useDeferredValue(rawPeek);

  const [filter, setFilter] = useState<WatchlistFilter>("all");
  const [sort, setSort] = useState<WatchlistSort>("recent");

  const wireFilter = toListFilter(filter);
  const { items, partial, hasNextPage, isFetchingNextPage, fetchNextPage } = useWatchlistItems(
    wireFilter ? { filter: wireFilter } : {},
  );
  const { data: counts } = useWatchlistCounts();
  const itemIndex = useMemo(() => new Map(items.map((i) => [i.id, i] as const)), [items]);

  // Mood mosaic / tonight pick / sort views operate on *loaded* pages. v2
  // intentionally does not auto-page through the full set — the header
  // pip counts are authoritative via `/counts`, the user pages in as they
  // scroll, and the filter chips short-circuit enrichment server-side.
  const buckets = useMemo(() => bucketize(items), [items]);

  const sortedByAdded = useMemo(() => items.slice().sort((a, b) => b.addedAt - a.addedAt), [items]);

  const tonight = useMemo<WatchlistItem | null>(() => {
    const candidates = [...buckets.available, ...buckets.inProgress];
    return candidates[0] ?? null;
  }, [buckets]);

  const alternates = useMemo<WatchlistItem[]>(() => {
    if (!tonight) return [];
    return [...buckets.available, ...buckets.inProgress]
      .filter((i) => i.id !== tonight.id)
      .slice(0, 4);
  }, [buckets, tonight]);

  const moodGroups = useMemo(() => deriveMoods(items), [items]);

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

  const peekParts = peek ? splitCompositeId(peek) : null;
  const detailsQuery = useHomeDetails(
    peekParts?.mediaId ?? null,
    (peekParts?.mediaType as MediaType | undefined) ?? null,
  );
  const localPeekItem = peek ? (itemIndex.get(peek) ?? null) : null;
  const peekItem = useMemo<MediaDetailItem | null>(() => {
    const fetched = detailsQuery.data;
    if (fetched) return { ...fetched.summary, ...fetched.details };
    // Fall back to the watchlist-list copy while the rich payload is in flight
    // so the modal renders title / poster / availability immediately.
    return (localPeekItem as MediaDetailItem | null) ?? null;
  }, [detailsQuery.data, localPeekItem]);
  const inWatchlist = useIsInWatchlist(peek ?? "");
  const add = useAddToWatchlist();
  const remove = useRemoveFromWatchlist();
  const handleToggleWatchlist = useCallback(() => {
    if (!peekItem) return;
    if (inWatchlist) {
      remove.mutate({ tmdbId: peekItem.tmdbId, mediaType: peekItem.mediaType });
    } else {
      add.mutate({
        request: {
          tmdbId: peekItem.tmdbId,
          mediaType: peekItem.mediaType,
          source: "manual",
        },
        seed: peekItem,
      });
    }
  }, [add, remove, inWatchlist, peekItem]);

  const readyForRow = useMemo(
    () =>
      [...buckets.available, ...buckets.inProgress].filter((i) => !tonight || i.id !== tonight.id),
    [buckets, tonight],
  );
  const awaitingItems = useMemo(() => [...buckets.requested, ...buckets.unavailable], [buckets]);

  const filterActive = filter !== "all";

  const sections = useMemo<WatchlistSection[]>(() => {
    if (filterActive) return [];
    const out: WatchlistSection[] = [];
    if (tonight) {
      out.push({
        kind: "tonight-pick",
        node: <TonightPick pick={tonight} alternates={alternates} onPeek={handlePeek} />,
      });
    }
    if (readyForRow.length > 0) {
      out.push({ kind: "ready-row", node: <ReadyRow items={readyForRow} onPeek={handlePeek} /> });
    }
    if (moodGroups.length > 0) {
      out.push({
        kind: "mood-mosaic",
        node: <MoodMosaic groups={moodGroups} onPeek={handlePeek} />,
      });
    }
    if (buckets.upcoming.length > 0) {
      out.push({
        kind: "coming-up",
        node: <ComingUp items={buckets.upcoming} onPeek={handlePeek} />,
      });
    }
    if (awaitingItems.length > 0) {
      out.push({ kind: "awaiting", node: <Awaiting items={awaitingItems} onPeek={handlePeek} /> });
    }
    if (sortedByAdded.length > 0) {
      out.push({
        kind: "recently-added",
        node: <RecentlyAdded items={sortedByAdded} onPeek={handlePeek} />,
      });
    }
    return out;
  }, [
    filterActive,
    tonight,
    alternates,
    readyForRow,
    moodGroups,
    buckets.upcoming,
    awaitingItems,
    sortedByAdded,
    handlePeek,
  ]);

  const loadMoreButton = hasNextPage ? (
    <div className="mt-8 flex justify-center">
      <Button
        variant="outline"
        size="sm"
        onClick={() => void fetchNextPage()}
        disabled={isFetchingNextPage}
      >
        {isFetchingNextPage ? m.watchlist_loading_more() : m.watchlist_load_more()}
      </Button>
    </div>
  ) : null;

  return (
    <main className="mx-auto w-full max-w-[100rem] px-4 sm:px-6 lg:px-8">
      {partial ? (
        <p
          role="status"
          className="mb-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-2 text-sm text-warning-foreground"
        >
          {m.watchlist_partial_banner()}
        </p>
      ) : null}
      <WatchlistHeader
        items={items}
        counts={counts}
        filter={filter}
        sort={sort}
        onFilterChange={setFilter}
        onSortChange={setSort}
      />
      <div className="pb-32">
        {items.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">{m.watchlist_empty()}</p>
        ) : filterActive ? (
          <>
            <WatchlistFilteredGrid
              items={filtered}
              filter={filter}
              sort={sort}
              onPeek={handlePeek}
            />
            {loadMoreButton}
          </>
        ) : (
          <VirtualWindowList
            items={sections}
            getKey={(s) => s.kind}
            estimateSize={(i) => SECTION_HEIGHT_PX[sections[i]!.kind]}
            renderItem={(s) => s.node}
            footer={loadMoreButton}
          />
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
