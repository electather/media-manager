import { Check, CircleAlert, Clock, Film, HelpCircle, Layers, Plus, Tv } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type MouseEvent,
} from "react";
import type { CompactMediaItem } from "@ent-mcp/shared/home";
import { m } from "@/paraglide/messages";
import { ClearLogo } from "@/shared/components/clear-logo";
import { LoadingImage } from "@/shared/components/loading-image";
import { MediaKindBadge } from "@/features/media/components/media-kind-badge";
import { TagChips } from "@/shared/components/tag-chips";
import { formatMinutesLeft } from "@/shared/lib/format/duration";
import { cn } from "@/shared/lib/utils";
import { Badge, type badgeVariants } from "@/shared/ui/badge";
import { Progress } from "@/shared/ui/progress";
import { Button } from "../../../shared/ui/button";
import { Link } from "@tanstack/react-router";
import type { VariantProps } from "class-variance-authority";

type Aspect = "16/9" | "2/3";
type Layout = "thumb" | "tile";
type Treatment = "continue-watching" | "upcoming" | "default";

const THUMB_WIDTH_PX = 160;

type ExtendedFields = {
  tags?: readonly string[];
  seriesStatus?: "ongoing" | "ended";
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
    <Link
      ref={ref}
      to={`/media/$id`}
      params={{ id: item.id }}
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
          <Progress
            value={progressPct(item.progress.watched, item.progress.total)}
            className="absolute inset-x-0 bottom-0"
            trackClassName="h-1 w-full rounded-none bg-background/45"
            indicatorClassName="bg-progress-watched"
            aria-hidden="true"
          />
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
    </Link>
  );
}

function progressPct(watched: number, total: number): number {
  if (!total || Number.isNaN(watched) || Number.isNaN(total)) return 0;
  const pct = (watched / total) * 100;
  if (pct < 0) return 0;
  if (pct > 100) return 100;
  return pct;
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
          <Progress
            value={progressPct(item.progress.watched, item.progress.total)}
            className="absolute inset-x-0 bottom-0"
            trackClassName="h-1 w-full rounded-none bg-background/45"
            indicatorClassName="bg-progress-watched"
            aria-hidden="true"
          />
        )}
      </div>
      <div className="flex min-w-0 flex-col justify-center">
        <div className="flex items-center gap-1.5">
          <MediaKindIcon mediaType={item.mediaType} />
          <div className="truncate text-sm font-medium text-foreground">{item.title}</div>
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
        "transition-[transform,box-shadow] duration-200 ease-out",
        "group-hover/media-card:shadow-[0_4px_18px_var(--card-glow,rgb(0_0_0/0.1))]",
        "group-[&:active:not(:has(button:active))]/media-card:scale-[0.99] group-[&:active:not(:has(button:active))]/media-card:shadow-[0_6px_22px_var(--card-glow,rgb(0_0_0/0.16))]",
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
      className="absolute inset-0 z-1 bg-linear-to-b from-transparent from-45% to-background/65"
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
  if (item.clearLogo) {
    return (
      <img
        src={item.clearLogo}
        alt={item.title}
        loading="lazy"
        decoding="async"
        className={cn(
          "absolute inset-x-3 bottom-3 z-2 max-h-[40%] w-auto object-contain object-start drop-shadow-[0_2px_18px_rgba(0,0,0,0.6)]",
        )}
      />
    );
  }
  return <ClearLogo text={item.title} size={isHero ? "lg" : "md"} />;
}

function CornerBadges({ item }: { item: MediaCardItem }) {
  return (
    <>
      {item.status && <MediaStatusBadge status={item.status} />}
      <MediaKindBadge mediaType={item.mediaType} />
    </>
  );
}

type MediaStatus = NonNullable<CompactMediaItem["status"]>;
type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

const STATUS_CONFIG: Record<
  MediaStatus,
  {
    label: () => string;
    Icon: ComponentType<{ className?: string }>;
    variant: BadgeVariant;
  }
> = {
  available: { label: () => m.media_card_status_available(), Icon: Check, variant: "success" },
  requested: { label: () => m.media_card_status_requested(), Icon: Clock, variant: "neutral" },
  processing: { label: () => m.media_card_status_processing(), Icon: Clock, variant: "info" },
  unavailable: {
    label: () => m.media_card_status_unavailable(),
    Icon: CircleAlert,
    variant: "warn",
  },
  unknown: { label: () => m.media_card_status_unknown(), Icon: HelpCircle, variant: "muted" },
};

function MediaStatusBadge({ status }: { status: MediaStatus }) {
  const config = STATUS_CONFIG[status];
  if (!config) return null;
  const { Icon } = config;
  return (
    <Badge variant={config.variant} className="absolute top-2.5 inset-s-2.5 z-3">
      <Icon />
      {config.label()}
    </Badge>
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
    <Button
      onClick={onToggle}
      aria-label={label}
      variant="outline"
      className={cn(
        "absolute inset-e-2 bottom-2 z-4 inline-flex size-7.5 items-center justify-center rounded-full backdrop-blur",
        "opacity-0 transition-opacity duration-200 group-hover/media-card:opacity-100 focus-visible:opacity-100",
      )}
    >
      {inWatchlist ? <Check /> : <Plus />}
    </Button>
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
