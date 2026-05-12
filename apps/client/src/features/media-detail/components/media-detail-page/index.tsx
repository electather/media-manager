import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  REQUEST_HISTORY_STALE_MS,
  REQUEST_TARGETS_STALE_MS,
  requestFlowKeys,
  requestsApi,
} from "@/features/request-flow";
import { useActiveSection } from "../../hooks/use-active-section";
import { useMediaItem } from "../../lib/find-item";
import { DetailFactsSidebar } from "../detail-facts-sidebar";
import { DetailHero } from "../detail-hero";
import { DetailHeroBackdrop } from "../detail-hero-backdrop";
import { DetailNotFound } from "../detail-not-found";
import { DetailSectionNav } from "../detail-section-nav";
import { buildSections } from "./build-sections";
import { DetailCastSection } from "./detail-cast-section";
import { DetailOverviewSection } from "./detail-overview-section";
import { DetailRelatedSection } from "./detail-related-section";
import { DetailSeasonsSection } from "./detail-seasons-section";
import { DetailYourTakeSection } from "./detail-your-take-section";
import { readNavStackPx, scrollToSection } from "./scroll-helpers";

type Props = {
  compositeId: string;
};

export function MediaDetailPage({ compositeId }: Props) {
  const { item, isLoading, detailsErrorCode } = useMediaItem(compositeId);
  const sections = useMemo(() => buildSections(item), [item]);
  const sectionIds = useMemo(() => sections.map((section) => section.id), [sections]);
  const hasCast = sections.some((s) => s.id === "cast");
  const hasSeason = sections.some((s) => s.id === "seasons");
  const navStackPx = readNavStackPx();
  const activeId = useActiveSection(sectionIds, navStackPx);

  const handleJump = useCallback((id: string) => scrollToSection(id, navStackPx), [navStackPx]);

  const queryClient = useQueryClient();

  // Warm the request-flow target cache as soon as the detail page mounts so
  // first picker open hits an already-resolved cache entry. The cache key is
  // `mediaType`-scoped, so visiting one detail page warms every other page of
  // the same media type for the session.
  const mediaType = item?.mediaType;
  useEffect(() => {
    if (!mediaType) return;
    void queryClient.prefetchQuery({
      queryKey: requestFlowKeys.targets(mediaType),
      queryFn: () => requestsApi.targets({ mediaType }),
      staleTime: REQUEST_TARGETS_STALE_MS,
    });
    void queryClient.prefetchQuery({
      queryKey: requestFlowKeys.history(),
      queryFn: () => requestsApi.history(),
      staleTime: REQUEST_HISTORY_STALE_MS,
    });
  }, [mediaType, queryClient]);

  const [watchlist, setWatchlist] = useState<ReadonlySet<string>>(() => new Set());
  const inWatchlist = item ? watchlist.has(item.id) : false;

  const toggleWatchlistId = useCallback((id: string) => {
    setWatchlist((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleWatchlist = useCallback(() => {
    if (!item) return;
    toggleWatchlistId(item.id);
  }, [item, toggleWatchlistId]);

  if (!item) {
    if (isLoading) return null;
    return <DetailNotFound />;
  }

  return (
    <div className="relative z-10 min-h-screen pb-30">
      <DetailHeroBackdrop src={item.backdrop} posterSrc={item.poster} />
      <DetailHero item={item} inWatchlist={inWatchlist} onToggleWatchlist={toggleWatchlist} />
      <div
        style={{
          background:
            "linear-gradient(to bottom, transparent 0, var(--background) 96px, var(--background) 100%)",
        }}
      >
        <DetailSectionNav sections={sections} activeId={activeId} onJump={handleJump} />
        <div className="mx-auto grid max-w-[1600px] gap-12 px-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex min-w-0 flex-col gap-14">
            <DetailOverviewSection item={item} detailsErrorCode={detailsErrorCode} />
            <DetailCastSection item={item} hasCast={hasCast} />
            <DetailSeasonsSection item={item} hasSeason={hasSeason} />
            <DetailYourTakeSection />
            <DetailRelatedSection
              item={item}
              watchlist={watchlist}
              onWatchlistToggle={toggleWatchlistId}
            />
          </div>
          <div className="hidden lg:block">
            <DetailFactsSidebar item={item} />
          </div>
        </div>
      </div>
    </div>
  );
}
