import { Check, Film, Layers, Plus, Tv } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import type { CompactMediaItem } from "@ent-mcp/shared/home";
import { m } from "@/paraglide/messages";
import { ClearLogo } from "@/shared/components/clear-logo";
import { LoadingImage } from "@/shared/components/loading-image";
import { MediaKindBadge } from "@/shared/components/media-kind-badge";
import { MediaStatusPill } from "@/shared/components/media-status-pill";
import { TagChips } from "@/shared/components/tag-chips";
import { ProgressBar } from "@/shared/components/progress-bar";
import { formatMinutesLeft } from "@/shared/lib/format/duration";
import { cn } from "@/shared/lib/utils";

type Aspect = "16/9" | "2/3";
type Layout = "thumb" | "tile";
type Treatment = "continue-watching" | "upcoming" | "default";

const THUMB_WIDTH_PX = 160;

type ExtendedFields = {
  tags?: readonly string[];
  seriesStatus?: "ongoing" | "ended";
  clearLogoText?: string;
};

export type MediaCardItem = CompactMediaItem & ExtendedFields;

export type MediaCardProps = {
  item: MediaCardItem;
  isHero?: boolean;
  forceLayout?: Layout | null;
  forceAspect?: Aspect | null;
  hideMeta?: boolean;
  inWatchlist: boolean;
  onPeek: (id: string) => void;
  onToggleWatchlist: (id: string) => void;
};

export function MediaCard({
  item,
  isHero = false,
  forceLayout = null,
  forceAspect = null,
  hideMeta = false,
  inWatchlist,
  onPeek,
  onToggleWatchlist,
}: MediaCardProps) {
  const ref = useRef<HTMLAnchorElement>(null);
  const [autoThumb, setAutoThumb] = useState(false);
  const [glowColor, setGlowColor] = useState<string | null>(null);

  useEffect(() => {
    if (forceLayout) return;
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setAutoThumb(entry.contentRect.width < THUMB_WIDTH_PX);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [forceLayout]);

  const layout: Layout = forceLayout ?? (autoThumb ? "thumb" : "tile");
  const treatment = resolveTreatment(item);
  const aspect = resolveAspect(item, layout, isHero, forceAspect);
  const imageSrc = pickImage(item, aspect);
  const handleClick = makePeekHandler(item.id, onPeek);

  if (layout === "thumb") {
    return (
      <ThumbCard
        anchorRef={ref}
        item={item}
        treatment={treatment}
        imageSrc={imageSrc}
        onClick={handleClick}
      />
    );
  }

  return (
    <a
      ref={ref}
      href={`/media/${item.id}`}
      onClick={handleClick}
      data-hero={isHero ? "true" : "false"}
      aria-label={mediaAriaLabel(item)}
      className="group/media-card block @container/media-card"
    >
      <CardFrame aspect={aspect} glowColor={glowColor}>
        <LoadingImage
          src={imageSrc}
          alt={item.title}
          className="absolute inset-0 size-full rounded-[inherit] object-cover"
          onColor={setGlowColor}
        />
        {aspect === "16/9" && <BackdropScrim />}
        <ClearLogoOverlay aspect={aspect} item={item} isHero={isHero} />
        <CornerBadges item={item} />
        {treatment === "continue-watching" && item.progress && (
          <ProgressBar ratio={item.progress.watched / item.progress.total} />
        )}
        {!isHero && (
          <WatchlistQuickAction
            inWatchlist={inWatchlist}
            onToggle={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onToggleWatchlist(item.id);
            }}
          />
        )}
      </CardFrame>
      {!hideMeta && <CardMeta item={item} treatment={treatment} />}
    </a>
  );
}

function resolveTreatment(item: MediaCardItem): Treatment {
  if (item.progress) return "continue-watching";
  if (item.episode) return "upcoming";
  return "default";
}

function resolveAspect(
  item: MediaCardItem,
  layout: Layout,
  isHero: boolean,
  forceAspect: Aspect | null,
): Aspect {
  if (forceAspect) return forceAspect;
  if (item.progress || isHero || layout === "thumb" || !item.poster) return "16/9";
  return "2/3";
}

function pickImage(item: MediaCardItem, aspect: Aspect): string {
  const wide = item.backdrop ?? item.poster ?? "";
  const tall = item.poster ?? item.backdrop ?? "";
  return aspect === "16/9" ? wide : tall;
}

function mediaAriaLabel(item: MediaCardItem): string {
  if (!item.year) return item.title;
  return m.media_card_aria_label({ title: item.title, year: item.year });
}

function makePeekHandler(id: string, onPeek: (id: string) => void) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (event.button !== 0) return;
    event.preventDefault();
    onPeek(id);
  };
}

type ThumbCardProps = {
  anchorRef: React.RefObject<HTMLAnchorElement | null>;
  item: MediaCardItem;
  treatment: Treatment;
  imageSrc: string;
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
};

function ThumbCard({ anchorRef, item, treatment, imageSrc, onClick }: ThumbCardProps) {
  return (
    <a
      ref={anchorRef}
      href={`/media/${item.id}`}
      onClick={onClick}
      aria-label={mediaAriaLabel(item)}
      className="grid grid-cols-[104px_1fr] items-center gap-3 rounded-lg p-2 transition-colors duration-200 hover:bg-muted"
    >
      <div className="relative aspect-video overflow-hidden rounded-md">
        <LoadingImage
          src={imageSrc}
          alt={item.title}
          className="absolute inset-0 size-full object-cover"
        />
        {treatment === "continue-watching" && item.progress && (
          <ProgressBar ratio={item.progress.watched / item.progress.total} />
        )}
      </div>
      <div className="flex min-w-0 flex-col justify-center">
        <div className="flex items-center gap-1.5">
          <MediaKindIcon mediaType={item.mediaType} />
          <div className="truncate text-[13px] font-medium text-foreground">{item.title}</div>
        </div>
        <ThumbMeta item={item} treatment={treatment} />
      </div>
    </a>
  );
}

function ThumbMeta({ item, treatment }: { item: MediaCardItem; treatment: Treatment }) {
  if (treatment === "upcoming" && item.episode) {
    return (
      <>
        <MetaLine className="mt-0.5">{formatEpisode(item.episode)}</MetaLine>
        <MetaLine className="mt-0.5 text-primary">{formatAirDate(item.episode.airsAt)}</MetaLine>
      </>
    );
  }
  if (treatment === "continue-watching" && item.progress) {
    return (
      <MetaLine className="mt-0.5">
        {formatMinutesLeft(item.progress.total - item.progress.watched)}
      </MetaLine>
    );
  }
  if (item.year) {
    return <MetaLine className="mt-0.5">{item.year}</MetaLine>;
  }
  return null;
}

type CardFrameProps = {
  aspect: Aspect;
  glowColor: string | null;
  children: React.ReactNode;
};

function CardFrame({ aspect, glowColor, children }: CardFrameProps) {
  const frameStyle: CSSProperties | undefined = glowColor
    ? ({ "--card-glow": glowColor } as CSSProperties)
    : undefined;
  const aspectClass = aspect === "16/9" ? "aspect-video" : "aspect-[2/3]";
  return (
    <div
      data-aspect={aspect}
      style={frameStyle}
      className={cn(
        "relative isolate overflow-hidden rounded-xl",
        aspectClass,
        "bg-muted ring-1 ring-foreground/10",
        "transition-shadow duration-300",
        "group-hover/media-card:shadow-[0_8px_32px_var(--card-glow,rgb(0_0_0_/_0.18))]",
      )}
    >
      {children}
    </div>
  );
}

function BackdropScrim() {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 z-1 bg-gradient-to-b from-transparent from-45% to-black/65"
    />
  );
}

function ClearLogoOverlay({
  aspect,
  item,
  isHero,
}: {
  aspect: Aspect;
  item: MediaCardItem;
  isHero: boolean;
}) {
  if (aspect !== "16/9") return null;
  if (item.clearLogoText) {
    return <ClearLogo text={item.clearLogoText} size={isHero ? "lg" : "md"} />;
  }
  if (item.clearLogo) {
    return (
      <img
        src={item.clearLogo}
        alt={item.title}
        loading="lazy"
        decoding="async"
        className={cn(
          "absolute inset-x-3 bottom-3 z-2 max-h-[40%] w-auto object-contain object-left drop-shadow-[0_2px_18px_rgba(0,0,0,0.6)]",
        )}
      />
    );
  }
  return null;
}

function CornerBadges({ item }: { item: MediaCardItem }) {
  const hasStatus = item.status != null;
  return (
    <>
      {hasStatus && <MediaStatusPill status={item.status!} />}
      {!hasStatus && <MediaKindBadge mediaType={item.mediaType} />}
      {hasStatus && (
        <span className="absolute top-2.5 right-2.5 z-3 inline-flex items-center justify-center rounded-md bg-black/50 p-1 text-muted-foreground backdrop-blur">
          {item.mediaType === "movie" ? <Film className="size-3" /> : <Tv className="size-3" />}
        </span>
      )}
    </>
  );
}

function WatchlistQuickAction({
  inWatchlist,
  onToggle,
}: {
  inWatchlist: boolean;
  onToggle: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const label = inWatchlist ? m.media_card_watchlist_remove() : m.media_card_watchlist_add();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      className={cn(
        "absolute right-2 bottom-2 z-4 inline-flex size-[30px] items-center justify-center rounded-full",
        "border border-border bg-black/55 text-foreground backdrop-blur",
        "opacity-0 transition-opacity duration-200 group-hover/media-card:opacity-100 focus-visible:opacity-100",
      )}
    >
      {inWatchlist ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
    </button>
  );
}

function CardMeta({ item, treatment }: { item: MediaCardItem; treatment: Treatment }) {
  return (
    <div className="pt-2">
      {treatment === "continue-watching" && item.progress ? (
        <ContinueWatchingMeta item={item} />
      ) : treatment === "upcoming" && item.episode ? (
        <UpcomingMeta item={item} />
      ) : (
        <DefaultMeta item={item} />
      )}
    </div>
  );
}

function ContinueWatchingMeta({ item }: { item: MediaCardItem }) {
  if (!item.progress) return null;
  const secondsLeft = item.progress.total - item.progress.watched;
  return (
    <div className="flex items-center justify-between gap-2">
      <MetaLine>{formatMinutesLeft(secondsLeft)}</MetaLine>
      <MetaLine className="flex items-center gap-1.5">
        {item.episodeProgress ? (
          <>
            <Layers className="size-3" />
            <span>
              {m.media_card_watched_count({
                watched: item.episodeProgress.watched,
                total: item.episodeProgress.total,
              })}
            </span>
          </>
        ) : (
          <span>{Math.round((item.progress.watched / item.progress.total) * 100)}%</span>
        )}
      </MetaLine>
    </div>
  );
}

function UpcomingMeta({ item }: { item: MediaCardItem }) {
  if (!item.episode) return null;
  return (
    <>
      <div className="flex items-center gap-1.5">
        <MediaKindIcon mediaType={item.mediaType} />
        <div className="truncate text-sm text-foreground">{item.title}</div>
      </div>
      <MetaLine className="mt-0.5">
        {formatEpisode(item.episode)} ·{" "}
        <span className="text-primary">{formatAirDate(item.episode.airsAt)}</span>
      </MetaLine>
    </>
  );
}

function DefaultMeta({ item }: { item: MediaCardItem }) {
  return (
    <>
      <div className="flex items-center gap-1.5">
        <MediaKindIcon mediaType={item.mediaType} />
        <div className="truncate text-sm text-foreground">{item.title}</div>
      </div>
      {item.year != null && (
        <MetaLine className="mt-0.5">
          {item.year}
          {item.mediaType === "tv" && item.seriesStatus && (
            <>
              {" · "}
              <span
                className={
                  item.seriesStatus === "ongoing" ? "text-success" : "text-muted-foreground"
                }
              >
                {item.seriesStatus === "ongoing" ? "Ongoing" : "Ended"}
              </span>
            </>
          )}
        </MetaLine>
      )}
      {item.tags && <TagChips tags={item.tags} />}
      {item.matchReason && (
        <div className="mt-0.5 text-[11px] text-muted-foreground/80">{item.matchReason}</div>
      )}
    </>
  );
}

function MediaKindIcon({ mediaType }: { mediaType: "movie" | "tv" }) {
  const Icon = mediaType === "movie" ? Film : Tv;
  return (
    <span className="inline-flex shrink-0 text-muted-foreground">
      <Icon className="size-3" />
    </span>
  );
}

function MetaLine({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("text-xs text-muted-foreground", className)}>{children}</div>;
}

function formatEpisode(episode: NonNullable<CompactMediaItem["episode"]>): string {
  const code = `S${pad(episode.season)}E${pad(episode.episode)}`;
  return episode.name ? `${code} · ${episode.name}` : code;
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function formatAirDate(airsAt: number): string {
  const diffMs = airsAt - Date.now();
  const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  return formatter.format(diffDays, "day");
}
