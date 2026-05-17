import { Suspense, useCallback, useMemo, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { HeroSlide, HomeLayoutResponse } from "@ent-mcp/shared/home";
import type { MediaType } from "@ent-mcp/shared/media";
import { MediaDetailModal, type MediaDetailItem } from "@/features/media-detail";
import { splitCompositeId } from "@/shared/lib/media-id";
import { useHomeFeed } from "../hooks/use-home-feed";
import { useHomeDetails } from "../hooks/use-home-details";
import { ROW_ASPECT } from "../lib/home-feed-config";
import type { HeroSlideUI, RowData } from "../lib/types";
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
  const { peek } = useSearch({ strict: false }) as PeekSearch;
  const navigate = useNavigate();
  const [watchlist, setWatchlist] = useState<Set<string>>(() => new Set());

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
      void navigate({ to: ".", search: { peek: id }, replace: true, resetScroll: false });
    },
    [navigate],
  );

  const handleClose = useCallback(() => {
    void navigate({ to: ".", search: {}, replace: true, resetScroll: false });
  }, [navigate]);

  const toggleWatchlistId = useCallback((id: string) => {
    setWatchlist((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const inWatchlist = peek ? watchlist.has(peek) : false;
  const handleToggleWatchlistFromModal = useCallback(() => {
    if (!peek) return;
    toggleWatchlistId(peek);
  }, [peek, toggleWatchlistId]);

  const heroSlides: HeroSlideUI[] = layout.hero?.slides?.map(toHeroSlideUI) ?? [];
  const rows: RowData[] = layout.rows.map(toRowData);

  return (
    <div className="mx-auto flex w-full max-w-400 flex-col gap-10 px-4 pb-32 sm:px-6 lg:px-8">
      {heroSlides.length > 0 ? <TopZone slides={heroSlides} onPeek={handlePeek} /> : null}
      <div className="relative z-10 flex flex-col gap-2">
        {rows.map((row) => (
          <Row
            key={row.id}
            row={row}
            watchlist={watchlist}
            onWatchlistToggle={toggleWatchlistId}
            onCardClick={handlePeek}
          />
        ))}
      </div>
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
    id: stub.rowId,
    kind: stub.kind,
    initialCursor: stub.initialCursor,
    defaultAspect: ROW_ASPECT[stub.kind] ?? "16/9",
    headerKey: stub.titleKey as RowData["headerKey"],
  };
  if (stub.eyebrowKey) out.eyebrowKey = stub.eyebrowKey as RowData["eyebrowKey"];
  return out;
}
