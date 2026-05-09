import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import * as m from "@/paraglide/messages";
import { ModalNote } from "@/shared/components/media-detail-modal/modal-note";
import { ModalSeasons } from "@/shared/components/media-detail-modal/modal-seasons";
import { ModalTVAirInfo } from "@/shared/components/media-detail-modal/modal-tv-air-info";
import type { MediaDetailItem } from "@/shared/components/media-detail-modal";
import type { HomeMediaItem } from "@/features/home/lib/types";
import {
  REQUEST_HISTORY_STALE_MS,
  REQUEST_TARGETS_STALE_MS,
  requestFlowKeys,
  requestsApi,
} from "@/features/request-flow";
import { splitCompositeId } from "@/shared/lib/media-id";
import { useMediaItem } from "../lib/find-item";
import { useActiveSection } from "../hooks/use-active-section";
import { DetailBreadcrumb } from "./detail-breadcrumb";
import { DetailCastGrid } from "./detail-cast-grid";
import { DetailFactsSidebar } from "./detail-facts-sidebar";
import { DetailHero } from "./detail-hero";
import { DetailHeroBackdrop } from "./detail-hero-backdrop";
import { DetailNotFound } from "./detail-not-found";
import { DetailRelatedRow } from "./detail-related-row";
import { DetailSection } from "./detail-section";
import { DetailSectionNav, type DetailSection as Section } from "./detail-section-nav";

/**
 * Single source of truth for the scroll-jump landing offset and the
 * active-section trigger line. Derived from the `--detail-section-nav-stack`
 * CSS var so a sticky-nav redesign updates both at once. Falls back to a
 * sensible default when the var is missing (e.g. during SSR snapshots).
 */
function readNavStackPx(): number {
  if (typeof window === "undefined") return 150;
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue("--detail-section-nav-stack")
    .trim();
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : 150;
}

type Props = {
  compositeId: string;
};

function buildSections(item: HomeMediaItem | null): Section[] {
  if (!item) return [];
  const castCount = (item.cast?.length ?? 0) + (item.director ? 1 : 0);
  const seasonCount = item.seasons?.length ?? 0;
  const sections: (Section | null)[] = [
    { id: "overview", label: m.media_detail_section_overview() },
    castCount > 0 ? { id: "cast", label: m.media_detail_section_cast(), count: castCount } : null,
    seasonCount > 0
      ? { id: "seasons", label: m.media_detail_section_seasons(), count: seasonCount }
      : null,
    { id: "your-take", label: m.media_detail_section_your_take() },
    { id: "related", label: m.media_detail_section_related() },
  ];
  return sections.filter((section): section is Section => section !== null);
}

export function MediaDetailPage({ compositeId }: Props) {
  const { item, isLoading } = useMediaItem(compositeId);
  const sections = useMemo(() => buildSections(item), [item]);
  const sectionIds = useMemo(() => sections.map((section) => section.id), [sections]);
  const navStackPx = useMemo(readNavStackPx, []);
  const activeId = useActiveSection(sectionIds, navStackPx);

  const scrollToSection = useCallback(
    (id: string) => {
      const target = document.getElementById(id);
      if (!target) return;
      const top = target.getBoundingClientRect().top + window.scrollY - navStackPx;
      window.scrollTo({ top, behavior: "smooth" });
    },
    [navStackPx],
  );

  const navigate = useNavigate();
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
  const [note, setNote] = useState("");
  const [noteEditing, setNoteEditing] = useState(false);
  const noteSectionRef = useRef<HTMLDivElement>(null);
  const noteTaRef = useRef<HTMLTextAreaElement>(null);

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

  const handleRelatedClick = useCallback(
    (id: string) => {
      const parts = splitCompositeId(id);
      if (!parts) return;
      void navigate({
        to: "/media/$mediaType/$mediaId",
        params: parts,
      });
    },
    [navigate],
  );

  if (!item) {
    if (isLoading) return null;
    return <DetailNotFound />;
  }

  const hasCast = (item.cast?.length ?? 0) > 0 || Boolean(item.director);

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
        <DetailSectionNav sections={sections} activeId={activeId} onJump={scrollToSection} />
        <div className="mx-auto grid max-w-[1600px] gap-12 px-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex min-w-0 flex-col gap-14">
            <DetailSection id="overview" title={m.media_detail_section_overview()}>
              <DetailBreadcrumb item={item} />
              {item.overview ? (
                <p className="m-0 max-w-180 text-pretty text-base leading-relaxed text-foreground/85">
                  {item.overview}
                </p>
              ) : null}
              <UnpaddedModalSlot>
                <ModalTVAirInfo item={item as MediaDetailItem} />
              </UnpaddedModalSlot>
            </DetailSection>

            {hasCast ? (
              <DetailSection id="cast" title={m.media_detail_section_cast()}>
                <DetailCastGrid item={item} />
              </DetailSection>
            ) : null}

            {(item.seasons?.length ?? 0) > 0 ? (
              <DetailSection id="seasons" title={m.media_detail_section_seasons()}>
                <UnpaddedModalSlot>
                  <ModalSeasons item={item as MediaDetailItem} />
                </UnpaddedModalSlot>
              </DetailSection>
            ) : null}

            <DetailSection id="your-take" title={m.media_detail_section_your_take()}>
              <UnpaddedModalSlot>
                <ModalNote
                  sectionRef={noteSectionRef}
                  taRef={noteTaRef}
                  note={note}
                  editing={noteEditing}
                  setEditing={setNoteEditing}
                  onSave={setNote}
                />
              </UnpaddedModalSlot>
            </DetailSection>

            <DetailSection id="related" title={m.media_detail_section_related()}>
              <DetailRelatedRow
                item={item}
                watchlist={watchlist}
                onWatchlistToggle={toggleWatchlistId}
                onCardClick={handleRelatedClick}
              />
            </DetailSection>
          </div>
          <div className="hidden lg:block">
            <DetailFactsSidebar item={item} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Strips the `px-6 sm:px-10` gutter that the shared `Modal*` components apply
 * for the modal's narrower surface, so they slot cleanly into the page's own
 * gridded gutter without nested padding.
 */
function UnpaddedModalSlot({ children }: { children: React.ReactNode }) {
  return (
    <div className="[&>div]:px-0! [&>section]:px-0! [&>div]:sm:px-0! [&>section]:sm:px-0!">
      {children}
    </div>
  );
}
