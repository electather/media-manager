import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import * as m from "@/paraglide/messages";
import { ModalNote } from "@/shared/components/media-detail-modal/modal-note";
import { ModalSeasons } from "@/shared/components/media-detail-modal/modal-seasons";
import { ModalTVAirInfo } from "@/shared/components/media-detail-modal/modal-tv-air-info";
import type { MediaDetailItem } from "@/shared/components/media-detail-modal";
import { findMediaItem, splitCompositeId } from "../lib/find-item";
import { useActiveSection } from "../hooks/use-active-section";
import { DetailBreadcrumb } from "./detail-breadcrumb";
import { DetailCastGrid } from "./detail-cast-grid";
import { DetailFactsSidebar } from "./detail-facts-sidebar";
import { DetailHero } from "./detail-hero";
import { DetailNotFound } from "./detail-not-found";
import { DetailRelatedRow } from "./detail-related-row";
import { DetailSection } from "./detail-section";
import { DetailSectionNav, type DetailSection as Section } from "./detail-section-nav";

const SECTION_NAV_OFFSET_PX = 140;
const SCROLL_OFFSET_PX = 110;

type Props = {
  compositeId: string;
};

function buildSections(item: ReturnType<typeof findMediaItem>): Section[] {
  if (!item) return [];
  const hasEpisodes = item.mediaType === "tv" && (item.seasons?.length ?? 0) > 0;
  const castCount = (item.cast?.length ?? 0) + (item.director ? 1 : 0);
  const sections: (Section | null)[] = [
    { id: "overview", label: m.media_detail_section_overview() },
    hasEpisodes ? { id: "episodes", label: m.media_detail_section_episodes() } : null,
    castCount > 0 ? { id: "cast", label: m.media_detail_section_cast(), count: castCount } : null,
    { id: "your-take", label: m.media_detail_section_your_take() },
    { id: "related", label: m.media_detail_section_related() },
  ];
  return sections.filter((section): section is Section => section !== null);
}

/**
 * `useMockPagination` clones cards with a `#clone-N` id suffix so React keys
 * stay unique. Strip the suffix before resolving against the data layer or
 * navigating, so cloned cards still open the original media's detail page.
 */
function sourceIdOf(id: string): string {
  const hash = id.indexOf("#");
  return hash === -1 ? id : id.slice(0, hash);
}

function scrollToSection(id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  const top = target.getBoundingClientRect().top + window.scrollY - SCROLL_OFFSET_PX;
  window.scrollTo({ top, behavior: "smooth" });
}

export function MediaDetailPage({ compositeId }: Props) {
  const item = findMediaItem(compositeId);
  const sections = useMemo(() => buildSections(item), [item]);
  const sectionIds = useMemo(() => sections.map((section) => section.id), [sections]);
  const activeId = useActiveSection(sectionIds, SECTION_NAV_OFFSET_PX);

  const navigate = useNavigate();
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
      const parts = splitCompositeId(sourceIdOf(id));
      if (!parts) return;
      void navigate({
        to: "/media/$mediaType/$mediaId",
        params: parts,
      });
    },
    [navigate],
  );

  if (!item) return <DetailNotFound />;

  const hasEpisodes = item.mediaType === "tv" && (item.seasons?.length ?? 0) > 0;
  const hasCast = (item.cast?.length ?? 0) > 0 || Boolean(item.director);

  return (
    <div className="min-h-screen pb-30">
      <DetailHero item={item} inWatchlist={inWatchlist} onToggleWatchlist={toggleWatchlist} />
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

          {hasEpisodes ? (
            <DetailSection id="episodes" title={m.media_detail_section_episodes()}>
              <UnpaddedModalSlot>
                <ModalSeasons item={item as MediaDetailItem} />
              </UnpaddedModalSlot>
            </DetailSection>
          ) : null}

          {hasCast ? (
            <DetailSection id="cast" title={m.media_detail_section_cast()}>
              <DetailCastGrid item={item} />
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
