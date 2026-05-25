import { cn } from "@/shared/lib/utils";

type Aspect = "16/9" | "1/1" | "2/3";

const ASPECT_CLASS: Record<Aspect, string> = {
  "16/9": "aspect-video",
  "1/1": "aspect-square",
  "2/3": "aspect-[2/3]",
};

interface Props {
  src?: string | null;
  alt?: string;
  aspect?: Aspect;
  /** Tailwind width class for the thumb (defaults to a 16:9-friendly `w-16`). */
  widthClassName?: string;
  className?: string;
}

/**
 * Thumbnail slot for a `MediaRow`. Renders a fixed-size box that holds the
 * image (object-cover) and degrades to a muted block when no `src` is
 * available. Width is controllable so callers can match row density.
 */
export function MediaRowThumb({
  src,
  alt = "",
  aspect = "16/9",
  widthClassName = "w-16",
  className,
}: Props) {
  return (
    <span
      data-slot="media-row-thumb"
      className={cn(
        "relative shrink-0 overflow-hidden rounded-md bg-muted",
        widthClassName,
        ASPECT_CLASS[aspect],
        className,
      )}
    >
      {src ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
    </span>
  );
}
