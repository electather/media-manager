import { useState } from "react";
import { cn } from "@/shared/lib/utils";
import { Skeleton } from "@/shared/ui/skeleton";
import type { HomeMediaItem } from "../../lib/types";

interface CardImageProps {
  item: HomeMediaItem;
  aspect: "16/9" | "2/3";
}

/**
 * Renders the poster or backdrop for a card with a skeleton placeholder while
 * loading and a bottom-up scrim on 16/9 art so overlays remain readable.
 */
export function CardImage({ item, aspect }: CardImageProps) {
  const [loaded, setLoaded] = useState(false);
  const src = aspect === "16/9" ? (item.backdrop ?? item.poster) : (item.poster ?? item.backdrop);
  const aspectClass = aspect === "16/9" ? "aspect-video" : "aspect-[2/3]";
  return (
    <div className={cn("relative w-full overflow-hidden rounded-md bg-muted", aspectClass)}>
      {!loaded ? <Skeleton className="absolute inset-0 rounded-md" /> : null}
      {src ? (
        <img
          src={src}
          alt={item.title}
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
          <span className="text-xs text-muted-foreground">{item.title}</span>
        </div>
      )}
      {aspect === "16/9" ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-transparent"
        />
      ) : null}
    </div>
  );
}
