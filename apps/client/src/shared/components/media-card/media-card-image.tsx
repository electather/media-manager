import { useState } from "react";
import { cn } from "@/shared/lib/utils";
import { Skeleton } from "@/shared/ui/skeleton";

type Aspect = "16/9" | "2/3";

interface MediaCardImageProps {
  src?: string | null;
  alt: string;
  aspect: Aspect;
  /** Renders a bottom-up scrim on 16/9 art so overlays stay legible. Defaults on for 16/9. */
  scrim?: boolean;
  /** Fallback text rendered centered when `src` is empty. */
  fallback?: string;
  className?: string;
}

/**
 * Skeleton-bridged image with optional scrim. Presentational only — the
 * caller picks which artwork URL (poster vs backdrop) to thread in.
 */
export function MediaCardImage({
  src,
  alt,
  aspect,
  scrim,
  fallback,
  className,
}: MediaCardImageProps) {
  const [loaded, setLoaded] = useState(false);
  const aspectClass = aspect === "16/9" ? "aspect-video" : "aspect-[2/3]";
  const showScrim = scrim ?? aspect === "16/9";
  return (
    <div
      data-slot="media-card-image"
      className={cn("relative w-full overflow-hidden rounded-md bg-muted", aspectClass, className)}
    >
      {!loaded ? <Skeleton className="absolute inset-0 rounded-md" /> : null}
      {src ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(true)}
          className={cn(
            "absolute inset-0 size-full object-cover transition-opacity duration-300",
            loaded ? "opacity-100" : "opacity-0",
          )}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs text-muted-foreground">{fallback ?? alt}</span>
        </div>
      )}
      {showScrim ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-transparent"
        />
      ) : null}
    </div>
  );
}
