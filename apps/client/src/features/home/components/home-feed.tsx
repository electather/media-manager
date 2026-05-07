import { useCallback, useMemo, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { HeroSlide } from "@ent-mcp/shared/home";
import * as m from "@/paraglide/messages";
import { MediaDetailModal, type MediaDetailItem } from "@/shared/components/media-detail-modal";
import { Skeleton } from "@/shared/ui/skeleton";
import { splitCompositeId } from "@/shared/lib/media-id";
import { useHomeFeed } from "../hooks/use-home-feed";
import { useHomeDetails } from "../hooks/use-home-details";
import { ROW_ASPECT } from "../lib/home-feed-config";
import type { HeroSlideUI, RowData } from "../lib/types";
import { Row } from "./row/index";
import { TopZone } from "./top-zone";

// Local re-type. Importing the type from `@/lib/home-display` crosses the
// `client-feat-home → client-features-legacy` zone boundary.
type PeekSearch = { peek?: string };

/**
 * Home feed entry point. Hits `home.getLayout` once for the hero + row stubs;
 * each row hydrates its own items via `useHomeRow`. The detail modal pulls
 * the rich payload via `useHomeDetails` so the parent never indexes items
 * across rows — the peek id is the only hand-off the modal needs.
 */
export function HomeFeed() {
  const layoutQuery = useHomeFeed();
  if (layoutQuery.error) return <HomeFeedError />;
  if (!layoutQuery.data) return <HomeFeedSkeleton />;
  return <HomeFeedReady layout={layoutQuery.data} />;
}

// fallow-ignore-next-line complexity
function HomeFeedReady({
  layout,
}: {
  layout: NonNullable<ReturnType<typeof useHomeFeed>["data"]>;
}) {
  const { peek } = useSearch({ strict: false }) as PeekSearch;
  const navigate = useNavigate();
  const [watchlist, setWatchlist] = useState<Set<string>>(() => new Set());

  const peekParts = peek ? splitCompositeId(peek) : null;
  const detailsQuery = useHomeDetails(
    peekParts?.mediaId ?? null,
    (peekParts?.mediaType as "movie" | "tv" | undefined) ?? null,
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
    void navigate({ to: ".", search: {}, replace: false, resetScroll: false });
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

  const heroSlides: HeroSlideUI[] = layout.hero?.slides.map(toHeroSlideUI) ?? [];
  const rows: RowData[] = layout.rows.map(toRowData);

  return (
    <div className="mx-auto flex w-full max-w-400 flex-col gap-10 px-4 pb-32 sm:px-6 lg:px-8">
      {heroSlides.length > 0 ? <TopZone slides={heroSlides} onPeek={handlePeek} /> : null}
      <div className="flex flex-col gap-2">
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

function toRowData(
  stub: NonNullable<ReturnType<typeof useHomeFeed>["data"]>["rows"][number],
): RowData {
  const out: RowData = {
    id: stub.rowId,
    kind: stub.kind,
    initialCursor: stub.initialCursor,
    defaultAspect: ROW_ASPECT[stub.kind],
    headerKey: stub.titleKey as RowData["headerKey"],
  };
  if (stub.subtitleKey) out.subtitleKey = stub.subtitleKey as RowData["subtitleKey"];
  return out;
}

function HomeFeedSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-400 flex-col gap-10 px-4 pb-32 sm:px-6 lg:px-8">
      <Skeleton className="aspect-[16/7] w-full rounded-lg" />
      <div className="flex flex-col gap-6">
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
    </div>
  );
}

function HomeFeedError() {
  return (
    <div className="mx-auto flex w-full max-w-400 flex-col gap-2 px-4 pt-12 sm:px-6 lg:px-8">
      <p className="text-sm text-destructive">{m.home_feed_error()}</p>
    </div>
  );
}
