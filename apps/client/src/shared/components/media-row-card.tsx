import { memo, type HTMLAttributes, type ReactNode } from "react";
import type { CompactMediaItem } from "@ent-mcp/shared/home";
import {
  MediaCardAvailability,
  MediaCardClearLogo,
  MediaCardFrame,
  MediaCardImage,
  MediaCardLink,
  MediaCardRoot,
  deriveMediaCardAvailability,
} from "@/shared/components/media-card";
import { buildMediaHref } from "@/shared/lib/media-id";

export type MediaRowCardAspect = "16/9" | "2/3";

/**
 * Subset of the shared wire item the row card needs. Picked from
 * `CompactMediaItem` so home + watchlist render one source of truth.
 */
export type MediaRowCardItem = Pick<
  CompactMediaItem,
  "id" | "title" | "poster" | "backdrop" | "clearLogo" | "status" | "availability" | "facets"
> & {
  /** Wordmark fallback when no clear-logo image URL is available. */
  clearLogoText?: string;
};

interface MediaRowCardProps {
  item: MediaRowCardItem;
  aspect?: MediaRowCardAspect;
  /** Override detail href; defaults to `buildMediaHref(item.id)`. */
  href?: string | null;
  /** Plain-left-click handler; modified clicks fall through to the anchor. */
  onPress?: (id: string) => void;
  /** Aria label for the overlay link; defaults to `item.title`. */
  linkAriaLabel?: string;
  /** Top-end slot — kind badge, season chip, etc. */
  badge?: ReactNode;
  /** Bottom-fill slot — progress bar, hover scrub, etc. */
  progress?: ReactNode;
  /** Bottom-end slot — add/remove toggle, play button, etc. */
  quickAction?: ReactNode;
  /** Below-frame slot — title/year/meta strip. */
  meta?: ReactNode;
  /** Forwarded to the root `<article>` (e.g. `data-testid`). */
  rootProps?: Omit<HTMLAttributes<HTMLElement>, "children"> & {
    [key: `data-${string}`]: string | number | boolean | undefined;
  };
}

function pickImageSrc(item: MediaRowCardItem, aspect: MediaRowCardAspect): string | undefined {
  return aspect === "16/9" ? (item.backdrop ?? item.poster) : (item.poster ?? item.backdrop);
}

/**
 * Shared row-card primitive. Home + watchlist render this; per-feature
 * variations (badge content, meta strip, quick action) ride the slot props.
 * Wrapped in `memo` so paginated row appends don't re-render existing cards —
 * callers must keep `onPress` stable (e.g. via `useCallback`).
 */
export const MediaRowCard = memo(function MediaRowCard({
  item,
  aspect = "2/3",
  href,
  onPress,
  linkAriaLabel,
  badge,
  progress,
  quickAction,
  meta,
  rootProps,
}: MediaRowCardProps) {
  const showLogo = aspect === "16/9" && Boolean(item.clearLogo || item.clearLogoText);
  const imageSrc = pickImageSrc(item, aspect);
  const resolvedHref = href ?? buildMediaHref(item.id) ?? "#";

  return (
    <MediaCardRoot aspect={aspect} {...rootProps}>
      <MediaCardFrame>
        <MediaCardImage src={imageSrc} alt={item.title} aspect={aspect} />
        {showLogo ? (
          <MediaCardClearLogo src={item.clearLogo} text={item.clearLogoText} alt={item.title} />
        ) : null}
        <MediaCardAvailability
          state={deriveMediaCardAvailability(item)}
          className="pointer-events-none absolute inset-s-2 top-2"
        />
        {badge}
        {progress}
        {quickAction}
      </MediaCardFrame>
      {meta}
      <MediaCardLink
        href={resolvedHref}
        aria-label={linkAriaLabel ?? item.title}
        onPress={onPress ? () => onPress(item.id) : undefined}
      />
    </MediaCardRoot>
  );
});
