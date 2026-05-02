import { FilmIcon, StarIcon, TvIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/shared/ui/button";
import { LoadingImage } from "@/shared/components/loading-image";
import { Skeleton } from "@/shared/ui/skeleton";
import { m } from "@/paraglide/messages";
import { FeedbackBar } from "./feedback-bar";
import { ModalActionRow } from "./modal-action-row";
import { ModalSeasonsList } from "./modal-seasons-list";
import { NoteEditor } from "./note-editor";
import { ScoreBlock } from "./score-block";
import { TVAirInfo } from "./tv-air-info";
import { useDetailStore } from "../lib/use-detail-store";
import type { MediaDetail } from "../lib/types";

interface MediaDetailModalContentProps {
  item: MediaDetail;
  closePeek: () => void;
  /** True while the detail RPC is still in flight; renders skeletons for
   *  detail-only fields whose absence would otherwise read as "no value". */
  isHydrating?: boolean;
}

interface LogoBox {
  fromTop: number;
  fromLeft: number;
  toTop: number;
  toLeft: number;
  width: number;
}

const INITIAL_LOGO_BOX: LogoBox = {
  fromTop: 340,
  fromLeft: 28,
  toTop: 14,
  toLeft: 106,
  width: 600,
};

export function MediaDetailModalContent({
  item,
  closePeek,
  isHydrating = false,
}: MediaDetailModalContentProps) {
  const { watched, watchlist, toggleWatched, toggleWatchlist, openTrailer, notes } =
    useDetailStore();
  const isWatched = watched.has(item.id);
  const inWl = watchlist.has(item.id);
  const hasNote = !!notes[item.id]?.trim();

  const heroImage = item.backdrop ?? item.poster ?? "";
  const [noteEditing, setNoteEditing] = useState<boolean | undefined>(undefined);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const noteSectionRef = useRef<HTMLDivElement | null>(null);
  const noteTaRef = useRef<HTMLTextAreaElement | null>(null);
  const logoSlotRef = useRef<HTMLDivElement | null>(null);
  const topbarRef = useRef<HTMLDivElement | null>(null);
  const heroBgRef = useRef<HTMLDivElement | null>(null);
  const heroDarkenRef = useRef<HTMLDivElement | null>(null);
  const topbarBgRef = useRef<HTMLDivElement | null>(null);
  const kindBadgeRef = useRef<HTMLDivElement | null>(null);
  const kindBadgeLabelRef = useRef<HTMLSpanElement | null>(null);
  const floatingLogoRef = useRef<HTMLDivElement | null>(null);
  const floatingLogoTextRef = useRef<HTMLDivElement | null>(null);

  const scrollYRef = useRef(0);
  const logoBoxRef = useRef<LogoBox>(INITIAL_LOGO_BOX);
  const rafRef = useRef<number | null>(null);

  const applyScrollStyles = () => {
    const scrollY = scrollYRef.current;
    const lb = logoBoxRef.current;

    if (heroBgRef.current) {
      heroBgRef.current.style.transform = `translateY(${-Math.min(40, scrollY * 0.25)}px)`;
    }
    if (heroDarkenRef.current) {
      heroDarkenRef.current.style.opacity = String(Math.min(0.45, (scrollY / 380) * 0.45));
    }

    const migrateDist = Math.max(60, lb.fromTop - lb.toTop);
    const topbarBgOpacity = Math.min(1, Math.max(0, scrollY / migrateDist));
    if (topbarBgRef.current) {
      topbarBgRef.current.style.opacity = String(topbarBgOpacity);
      const blurPx = Math.round(topbarBgOpacity * 14);
      topbarBgRef.current.style.backdropFilter = `blur(${blurPx}px)`;
      (
        topbarBgRef.current.style as CSSStyleDeclaration & { webkitBackdropFilter?: string }
      ).webkitBackdropFilter = `blur(${blurPx}px)`;
    }
    if (topbarRef.current) {
      topbarRef.current.dataset.scrolled = String(topbarBgOpacity > 0.98);
    }

    const scrolledFromTop = lb.fromTop - scrollY;
    const logoTop = Math.max(lb.toTop, scrolledFromTop);
    const dockRange = 80;
    const rawDock = 1 - Math.min(1, Math.max(0, (scrolledFromTop - lb.toTop) / dockRange));
    const dockEased = 1 - Math.pow(1 - rawDock, 3);
    const logoLeft = lb.fromLeft + (lb.toLeft - lb.fromLeft) * dockEased;

    if (floatingLogoRef.current) {
      floatingLogoRef.current.style.top = `${logoTop}px`;
      floatingLogoRef.current.style.left = `${logoLeft}px`;
      floatingLogoRef.current.style.width = `${lb.width}px`;
    }
    if (floatingLogoTextRef.current) {
      const vw = window.innerWidth;
      const bodyFs = Math.min(36, Math.max(20, vw * 0.034));
      const barFs = Math.min(16, Math.max(13, vw * 0.016));
      const logoFs = bodyFs + (barFs - bodyFs) * dockEased;
      floatingLogoTextRef.current.style.fontSize = `${logoFs}px`;
      floatingLogoTextRef.current.style.textShadow = `0 2px ${18 - dockEased * 6}px oklch(0 0 0 / ${0.6 - dockEased * 0.2})`;
    }

    if (kindBadgeRef.current) {
      kindBadgeRef.current.style.padding = dockEased > 0.5 ? "5px 7px" : "5px 10px";
      kindBadgeRef.current.style.gap = dockEased > 0.5 ? "0px" : "6px";
    }
    if (kindBadgeLabelRef.current) {
      kindBadgeLabelRef.current.style.maxWidth = dockEased > 0.5 ? "0" : "80px";
      kindBadgeLabelRef.current.style.opacity = dockEased > 0.5 ? "0" : "1";
    }
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = 0;
    scrollYRef.current = 0;
    applyScrollStyles();
    const onScroll = () => {
      scrollYRef.current = el.scrollTop;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(applyScrollStyles);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, isHydrating]);

  useEffect(() => {
    const measure = () => {
      const slot = logoSlotRef.current;
      const bar = topbarRef.current;
      const scroller = scrollRef.current;
      if (!slot || !bar || !scroller) return;
      const shell = scroller.parentElement;
      if (!shell) return;
      const shellRect = shell.getBoundingClientRect();
      const slotRect = slot.getBoundingClientRect();
      const barRect = bar.getBoundingClientRect();
      const fromTop = slotRect.top - shellRect.top + scroller.scrollTop;
      const fromLeft = slotRect.left - shellRect.left;
      const badge = bar.querySelector("[data-topbar-kind-badge]");
      const bRect = badge ? badge.getBoundingClientRect() : barRect;
      const closeBtn = bar.querySelector("[data-topbar-close]");
      const cRect = closeBtn ? closeBtn.getBoundingClientRect() : null;
      const COLLAPSED_BADGE_WIDTH = 28;
      const badgeLeft = bRect.left - shellRect.left;
      const collapsedBadgeRight = badgeLeft + COLLAPSED_BADGE_WIDTH;
      const barCenterY = barRect.top - shellRect.top + barRect.height / 2;
      const toTop = barCenterY - 22;
      const toLeft = collapsedBadgeRight + 12;
      const rightEdge = cRect
        ? cRect.left - shellRect.left - 12
        : barRect.right - shellRect.left - 16;
      const width = Math.max(80, rightEdge - toLeft);
      logoBoxRef.current = { fromTop, fromLeft, toTop, toLeft, width };
      applyScrollStyles();
    };
    measure();
    const t1 = setTimeout(measure, 50);
    const t2 = setTimeout(measure, 260);
    window.addEventListener("resize", measure);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener("resize", measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHydrating, item.id]);

  useEffect(() => {
    requestAnimationFrame(applyScrollStyles);
  }, [isHydrating]);

  const jumpToNote = () => {
    const sc = scrollRef.current;
    const sect = noteSectionRef.current;
    if (!sc || !sect) return;
    setNoteEditing(true);
    const target = sect.offsetTop - 80;
    sc.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
    setTimeout(() => noteTaRef.current?.focus(), 320);
  };

  return (
    <>
      <div
        ref={heroBgRef}
        className="absolute inset-x-0 top-0 z-0 h-[70%] overflow-hidden will-change-transform"
      >
        <LoadingImage src={heroImage} alt="" className="size-full object-cover" />
        <div
          ref={heroDarkenRef}
          className="absolute inset-0 bg-background"
          style={{ opacity: 0 }}
        />
        <div className="absolute inset-0 bg-linear-to-b from-background/0 to-background to-80%" />
      </div>

      <div
        ref={topbarRef}
        className="absolute inset-x-0 top-0 z-20 flex h-12 items-center gap-3 px-4"
      >
        <div
          aria-hidden="true"
          ref={topbarBgRef}
          className="pointer-events-none absolute inset-0 border-b border-border bg-background/85"
          style={{ opacity: 0 }}
        />
        <div
          ref={kindBadgeRef}
          data-topbar-kind-badge
          className="relative inline-flex items-center gap-1.5 rounded-full border border-foreground/10 bg-black/55 px-2.5 py-1 text-[11px] font-medium tracking-[0.04em] whitespace-nowrap text-foreground uppercase backdrop-blur-md"
        >
          {item.mediaType === "movie" ? (
            <FilmIcon className="size-3" />
          ) : (
            <TvIcon className="size-3" />
          )}
          <span
            ref={kindBadgeLabelRef}
            className="inline-block overflow-hidden transition-[max-width,opacity] duration-200"
            style={{ maxWidth: 80, opacity: 1 }}
          >
            {item.mediaType === "movie" ? m.media_details_kind_movie() : m.media_details_kind_tv()}
          </span>
        </div>
        <div data-topbar-logo-slot className="h-6 min-w-0 flex-1" />
        <Button
          data-topbar-close
          onClick={closePeek}
          variant="ghost"
          size="icon-sm"
          aria-label={m.media_details_close()}
          className="relative shrink-0"
        >
          <XIcon className="size-4" />
        </Button>
      </div>
      <div
        ref={floatingLogoRef}
        aria-hidden="true"
        className="pointer-events-none absolute z-30 flex h-11 items-center"
        style={{
          top: "calc(40vh + 20px)",
          left: logoBoxRef.current.fromLeft,
          width: logoBoxRef.current.width,
        }}
      >
        <div
          ref={floatingLogoTextRef}
          className="max-w-full truncate text-[36px] font-semibold leading-tight text-foreground will-change-transform"
          style={{
            letterSpacing: "-0.015em",
            textShadow: "0 2px 18px oklch(0 0 0 / 0.6)",
          }}
        >
          {item.title}
        </div>
      </div>

      <div ref={scrollRef} className="relative z-0 size-full overflow-y-auto scroll-smooth">
        <div className="relative">
          <div className="h-[40vh]" aria-hidden="true" />
          <div className="relative bg-linear-to-b from-background/0 to-background/60 to-[80px]">
            <div className="relative px-7 pt-5 pb-7">
              <div
                ref={logoSlotRef}
                aria-hidden="true"
                className="mb-3.5 flex min-h-11 items-center invisible"
              >
                <span
                  className="font-mono font-bold tracking-[0.18em] whitespace-nowrap"
                  style={{ fontSize: "clamp(20px, 3.4vw, 36px)", lineHeight: 1 }}
                >
                  {item.title}
                </span>
              </div>

              <div className="mb-4 flex flex-wrap items-center gap-2.5 text-[13px] text-muted-foreground">
                {item.year && <span>{item.year}</span>}
                {item.runtime ? (
                  <>
                    <span>·</span>
                    <span>{item.runtime}</span>
                  </>
                ) : isHydrating ? (
                  <>
                    <span>·</span>
                    <Skeleton className="h-3 w-14" />
                  </>
                ) : null}
                {item.ageRating ? (
                  <span className="rounded border border-input px-1.5 py-0.5 text-[11px] font-medium text-foreground/80">
                    {item.ageRating}
                  </span>
                ) : isHydrating ? (
                  <Skeleton className="h-4 w-9 rounded" />
                ) : null}
                {item.genres && <span>{item.genres.join(" · ")}</span>}
              </div>

              <FeedbackBar itemId={item.id} onJumpToNote={jumpToNote} hasNote={hasNote} />

              <ModalActionRow
                item={item}
                inWl={inWl}
                isWatched={isWatched}
                toggleWatched={toggleWatched}
                toggleWatchlist={toggleWatchlist}
                openTrailer={openTrailer}
              />

              <TVAirInfo item={item} isHydrating={isHydrating} />

              {(isHydrating ||
                item.rating ||
                item.audienceScore != null ||
                item.criticScore != null) && (
                <div className="mb-4 flex flex-wrap gap-2">
                  {item.rating != null ? (
                    <div className="flex min-w-22 flex-col gap-0.5 rounded-md bg-muted px-3.5 py-2">
                      <div className="text-[11px] tracking-[0.06em] text-muted-foreground uppercase">
                        {m.media_details_rating()}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <StarIcon className="size-3.5 text-primary" />
                        <span className="text-lg font-semibold">{item.rating}</span>
                        {item.votes && (
                          <span className="text-[11px] text-muted-foreground">
                            ({(item.votes / 1000).toFixed(1)}k)
                          </span>
                        )}
                      </div>
                    </div>
                  ) : isHydrating ? (
                    <Skeleton className="h-12 min-w-22 rounded-md" />
                  ) : null}
                  {item.audienceScore != null ? (
                    <ScoreBlock
                      label={m.media_details_audience()}
                      value={`${item.audienceScore}%`}
                    />
                  ) : isHydrating ? (
                    <Skeleton className="h-12 w-22 rounded-md" />
                  ) : null}
                  {item.criticScore != null ? (
                    <ScoreBlock label={m.media_details_critics()} value={`${item.criticScore}%`} />
                  ) : isHydrating ? (
                    <Skeleton className="h-12 w-22 rounded-md" />
                  ) : null}
                </div>
              )}

              {item.tags && item.tags.length > 0 ? (
                <div className="mb-4 flex flex-wrap gap-1.5">
                  {item.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-md border border-border bg-muted px-2 py-1 font-mono text-[11px] tracking-[0.02em] text-foreground/80"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              ) : isHydrating ? (
                <div className="mb-4 flex flex-wrap gap-1.5">
                  <Skeleton className="h-6.5 w-16 rounded-md" />
                  <Skeleton className="h-6.5 w-20 rounded-md" />
                  <Skeleton className="h-6.5 w-14 rounded-md" />
                  <Skeleton className="h-6.5 w-24 rounded-md" />
                </div>
              ) : null}

              {item.overview && (
                <p className="mb-4 max-w-[640px] text-pretty text-[14px] leading-relaxed text-foreground/80">
                  {item.overview}
                </p>
              )}

              {item.cast || item.director ? (
                <div className="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13px] text-foreground/80">
                  {item.director && (
                    <>
                      <div className="text-muted-foreground">{m.media_details_director()}</div>
                      <div>{item.director}</div>
                    </>
                  )}
                  {item.cast && (
                    <>
                      <div className="text-muted-foreground">{m.media_details_starring()}</div>
                      <div>{item.cast.join(", ")}</div>
                    </>
                  )}
                </div>
              ) : isHydrating ? (
                <div className="mb-4 grid max-w-135 grid-cols-[80px_1fr] gap-x-4 gap-y-2.5">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-3 w-[60%]" />
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-3 w-[80%]" />
                </div>
              ) : null}

              <ModalSeasonsList item={item} isHydrating={isHydrating} />

              {item.matchReason && (
                <div className="mb-4 rounded-md bg-muted px-3 py-2.5 text-xs text-muted-foreground">
                  <span className="text-primary">{m.media_details_why_this()}</span>{" "}
                  {item.matchReason}
                </div>
              )}

              <div ref={noteSectionRef} className="mb-4">
                <NoteEditor
                  itemId={item.id}
                  taRef={noteTaRef}
                  editing={noteEditing}
                  setEditing={setNoteEditing}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
