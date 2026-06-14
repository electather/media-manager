import { Suspense, useCallback, useDeferredValue, useMemo } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { HeroSlide, HomeLayoutResponse } from "@nama/shared/home";
import type { MediaSourceId, MediaType } from "@nama/shared/media";
import { MediaDetailModal, type MediaDetailItem } from "@/features/media-detail";
import { splitCompositeId } from "@/shared/lib/media-id";
import { useIsInWatchlist, useToggleWatchlist } from "@/features/watchlist";
import { VirtualWindowList } from "@/shared/components/virtualized";
import { useHomeFeed } from "../hooks/use-home-feed";
import { useHomeDetails } from "../hooks/use-home-details";
import { ROW_ASPECT, estimateHomeRowHeight } from "../lib/home-feed-config";
import type { HeroSlideUI, RowData } from "../lib/types";
import { HomeEmpty } from "./home-empty";
import { HomeFeedSkeleton } from "./home-feed-skeleton";
import { Row } from "./row/index";
import { TopZone } from "./top-zone";

// Local re-type. Importing the type from `@/lib/home-display` crosses the
// `client-feat-home → client-features-legacy` zone boundary.
type PeekSearch = { peek?: string };

/**
 * Home feed entry point. The route loader prefetches `home.getLayout` via
 * `homeLayoutQueryOptions`, and the route owns the `<HomeErrorBoundary>`
 * wrapper plus a `pendingComponent` for the loader-pending state. The
 * inner `<Suspense>` is a defensive boundary covering revalidation /
 * cache-miss windows; the rich payload still flows through
 * `useSuspenseQuery` per skill rule 5.
 */
export function HomeFeed() {
  return (
    <Suspense fallback={<HomeFeedSkeleton />}>
      <HomeFeedReady />
    </Suspense>
  );
}

// fallow-ignore-next-line complexity
function HomeFeedReady() {
  const { data: layout } = useHomeFeed();
  const { peek: rawPeek } = useSearch({ strict: false }) as PeekSearch;
  // Defer so peek-derived values coalesce across the concurrent scheduler during rapid back/forward navigation.
  const peek = useDeferredValue(rawPeek);
  const navigate = useNavigate();
  const toggleWatchlist = useToggleWatchlist();

  const peekParts = peek ? splitCompositeId(peek) : null;
  const detailsQuery = useHomeDetails(
    peekParts?.mediaId ?? null,
    (peekParts?.mediaType as MediaType | undefined) ?? null,
  );
  const modalItem = useMemo<MediaDetailItem | null>(() => {
    const data = detailsQuery.data;
    if (!data) return null;
    return { ...data.summary, ...data.details };
  }, [detailsQuery.data]);

  const handleViewFullPage = useCallback(
    (item: MediaDetailItem) => {
      const parts = splitCompositeId(item.id);
      if (!parts) return;
      void navigate({ to: "/media/$mediaType/$mediaId", params: parts });
    },
    [navigate],
  );

  const handlePeek = useCallback(
    (id: string) => {
      void navigate({ to: ".", search: { peek: id }, replace: false, resetScroll: false });
    },
    [navigate],
  );

  const handleClose = useCallback(() => {
    void navigate({ to: ".", search: {}, replace: true, resetScroll: false });
  }, [navigate]);

  const inWatchlist = useIsInWatchlist(peek ?? "");
  const handleToggleWatchlistFromModal = useCallback(() => {
    if (!modalItem) return;
    toggleWatchlist(modalItem);
  }, [modalItem, toggleWatchlist]);

  const heroSlides = useMemo<HeroSlideUI[]>(
    () => layout.hero?.slides?.map(toHeroSlideUI) ?? [],
    [layout.hero],
  );
  const rows = useMemo<RowData[]>(() => layout.rows.map(toRowData), [layout.rows]);

  // Fresh install: nothing to show until the catalog warms. Render the
  // warming state; the layout query polls while empty (see homeLayoutQueryOptions).
  if (heroSlides.length === 0 && rows.length === 0) {
    return <HomeEmpty />;
  }

  return (
    <div className="mx-auto flex w-full max-w-400 flex-col gap-10 px-4 pb-32 sm:px-6 lg:px-8">
      <VirtualWindowList
        items={rows}
        getKey={(row) => row.id}
        estimateSize={(i) => estimateHomeRowHeight(rows[i] ?? rows[0]!)}
        header={
          heroSlides.length > 0 ? (
            <div className="mb-10">
              <TopZone slides={heroSlides} onPeek={handlePeek} />
            </div>
          ) : null
        }
        renderItem={(row) => (
          <Row row={row} onWatchlistToggle={toggleWatchlist} onCardClick={handlePeek} />
        )}
        className="relative z-10"
      />
      <MediaDetailModal
        item={modalItem}
        open={Boolean(peek)}
        onClose={handleClose}
        inWatchlist={inWatchlist}
        onToggleWatchlist={handleToggleWatchlistFromModal}
        onViewFullPage={handleViewFullPage}
      />
    </div>
  );
}

function toHeroSlideUI(slide: HeroSlide): HeroSlideUI {
  return {
    ...slide.item,
    source: slide.source,
    reason: slide.reason,
    resumeUrl: slide.resumeUrl,
  };
}

function toRowData(stub: HomeLayoutResponse["rows"][number]): RowData {
  const out: RowData = {
    // The wire types `rowId` as an opaque slug (`z.string()`); narrow it to
    // `MediaSourceId` once here, at the single wire-ingestion boundary. An
    // unknown slug still resolves to a clean 404 at fetch time (the resolver
    // validates `:sourceId` against the registry), but downstream code now
    // carries the precise type instead of a bare `string`.
    id: stub.rowId as MediaSourceId,
    kind: stub.kind,
    initialCursor: stub.initialCursor,
    defaultAspect: ROW_ASPECT[stub.kind] ?? "16/9",
    headerKey: stub.titleKey as RowData["headerKey"],
  };
  if (stub.eyebrowKey) out.eyebrowKey = stub.eyebrowKey as RowData["eyebrowKey"];
  return out;
}
