import { useState } from "react";
import { Skeleton } from "@/shared/ui/skeleton";
import type { HomeMediaItem } from "../../lib/types";

interface CardImageProps {
  item: HomeMediaItem;
  aspect: "16/9" | "2/3";
}

/** Renders the poster or backdrop image for a card, with a skeleton placeholder while loading. */
export function CardImage({ item, aspect }: CardImageProps) {
  const [loaded, setLoaded] = useState(false);
  const src = aspect === "16/9" ? item.backdrop : item.poster;
  const aspectClass = aspect === "16/9" ? "aspect-video" : "aspect-[2/3]";

  return (
    <div className={`relative w-full overflow-hidden rounded-md ${aspectClass}`}>
      {!loaded && <Skeleton className="absolute inset-0 rounded-md" />}
      {src ? (
        <img
          src={src}
          alt={item.title}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(true)}
          className="absolute inset-0 size-full object-cover transition-opacity duration-300"
          style={{ opacity: loaded ? 1 : 0 }}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-muted">
          <span className="text-xs text-muted-foreground">{item.title}</span>
        </div>
      )}
    </div>
  );
}
