// fallow-ignore-file unused-file
// Reason: this card lands before its consumers — it replaces the home `Card` and `WatchlistCard` assemblies, wired into both shells in US-008 / US-009.
import { memo, type ReactNode } from "react";
import { Film, Tv } from "lucide-react";
import type { CompactMediaItem } from "@ent-mcp/shared/media";
import {
  MediaCardAvailability,
  MediaCardBadge,
  MediaCardClearLogo,
  MediaCardFrame,
  MediaCardImage,
  MediaCardLink,
  MediaCardMeta,
  MediaCardProgress,
  MediaCardRoot,
  MediaCardSubtitle,
  MediaCardTitle,
  deriveMediaCardAvailability,
} from "@/shared/components/media-card";

/** Item shape the shared card renders. `clearLogoText` is a home-only display fallback. */
export type MediaRowCardItem = CompactMediaItem & { clearLogoText?: string | null };

export interface MediaRowCardProps {
  item: MediaRowCardItem;
  /** `rail` → 16/9 backdrop (continue-watching / upcoming); `grid` → 2/3 poster. */
  variant: "rail" | "grid";
  href: string;
  /** aria-label for the full-card link. */
  openLabel: string;
  /** Localized Film/Tv kind label for the badge. */
  kindLabel: string;
  onOpen?: () => void;
  /** The add/remove quick-action button slot. */
  action?: ReactNode;
  /**
   * Footer rendered below the frame — the match-reason chip + tag chips for
   * home, source/added metadata for watchlist. When omitted the grid variant
   * shows a default title + year footer and the rail variant shows nothing.
   */
  meta?: ReactNode;
}

/** Pick the artwork URL for the variant: backdrop leads on the rail, poster on the grid. */
function pickArtwork(item: MediaRowCardItem, isWide: boolean): string | undefined {
  return isWide ? (item.backdrop ?? item.poster) : (item.poster ?? item.backdrop);
}

/** Within-content watched percentage, or null when there is nothing to show. */
function watchedPercent(progress: CompactMediaItem["progress"]): number | null {
  if (!progress || progress.total <= 0) return null;
  return Math.round((progress.watched / progress.total) * 100);
}

/**
 * The one card both features render (design §B2). A `variant` prop selects the
 * rail (16/9 backdrop) vs grid (2/3 poster) shape; `action` and `meta` are slots
 * for the feature-specific quick action and footer. Composes the shared
 * `MediaCard*` primitives, replacing the home `Card` + `WatchlistCard` assemblies.
 *
 * Wrapped in `memo` because paginated lists render many cards; callers must pass
 * stable handlers / slot nodes to realise the win.
 */
export const MediaRowCard = memo(function MediaRowCard(props: MediaRowCardProps) {
  const { item, variant, href, openLabel, onOpen, meta } = props;
  return (
    <MediaCardRoot aspect={variant === "rail" ? "16/9" : "2/3"} data-testid="media-row-card">
      <CardArt item={item} variant={variant} kindLabel={props.kindLabel} action={props.action} />
      {meta ?? defaultFooter(variant, item)}
      <MediaCardLink href={href} aria-label={openLabel} onPress={onOpen} />
    </MediaCardRoot>
  );
});

interface CardArtProps {
  item: MediaRowCardItem;
  variant: "rail" | "grid";
  kindLabel: string;
  action?: ReactNode;
}

/** The framed artwork + overlays: image, clear-logo, availability, kind badge, progress, action. */
// The branch count is the irreducible per-overlay presentational fan-out the shared card consolidates.
// fallow-ignore-next-line complexity
function CardArt({ item, variant, kindLabel, action }: CardArtProps) {
  const isWide = variant === "rail";
  const aspect = isWide ? "16/9" : "2/3";
  // #516: only render the clear-logo wordmark when the item actually carries one.
  const showLogo = isWide && Boolean(item.clearLogo || item.clearLogoText);
  const KindIcon = item.mediaType === "movie" ? Film : Tv;
  const percent = watchedPercent(item.progress);
  return (
    <MediaCardFrame>
      <MediaCardImage src={pickArtwork(item, isWide)} alt={item.title} aspect={aspect} />
      {showLogo ? (
        <MediaCardClearLogo
          src={item.clearLogo ?? undefined}
          text={item.clearLogoText ?? undefined}
          alt={item.title}
        />
      ) : null}
      <MediaCardAvailability
        state={deriveMediaCardAvailability(item)}
        className="pointer-events-none absolute inset-s-2 top-2"
      />
      <MediaCardBadge position="top-end" title={kindLabel} aria-label={kindLabel}>
        <KindIcon aria-hidden="true" className="size-3.5" />
      </MediaCardBadge>
      {percent != null ? <MediaCardProgress percent={percent} ariaLabel={`${percent}%`} /> : null}
      {action}
    </MediaCardFrame>
  );
}

/** The grid variant shows a title + year footer when the feature passes no `meta`; the rail shows none. */
function defaultFooter(variant: "rail" | "grid", item: MediaRowCardItem): ReactNode {
  if (variant !== "grid") return null;
  return (
    <MediaCardMeta>
      <MediaCardTitle>{item.title}</MediaCardTitle>
      {item.year ? <MediaCardSubtitle>{item.year}</MediaCardSubtitle> : null}
    </MediaCardMeta>
  );
}
