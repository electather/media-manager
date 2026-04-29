import { useCallback, useEffect, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type { CompactMediaItem } from "@ent-mcp/shared/home";

import { Button } from "@/shared/ui/button";

import { Card } from "./card";

interface RowCarouselProps {
  items: CompactMediaItem[];
  hasMore: boolean;
  isFetchingNextPage: boolean;
  onProgress: (ratio: number) => void;
}

const PAGINATION_THRESHOLD = 0.75;

export function RowCarousel({ items, hasMore, isFetchingNextPage, onProgress }: RowCarouselProps) {
  const [emblaRef, embla] = useEmblaCarousel({
    dragFree: true,
    containScroll: "trimSnaps",
    slidesToScroll: "auto",
    align: "start",
    loop: false,
  });
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  useEffect(() => {
    if (!embla) return;
    const update = () => {
      setCanPrev(embla.canScrollPrev());
      setCanNext(embla.canScrollNext());
      const progress = embla.scrollProgress();
      onProgress(progress);
    };
    update();
    embla.on("select", update);
    embla.on("scroll", update);
    embla.on("reInit", update);
    return () => {
      embla.off("select", update);
      embla.off("scroll", update);
      embla.off("reInit", update);
    };
  }, [embla, onProgress]);

  const scrollPrev = useCallback(() => embla?.scrollPrev(), [embla]);
  const scrollNext = useCallback(() => embla?.scrollNext(), [embla]);

  return (
    <div className="group/row relative">
      <div ref={emblaRef} className="overflow-hidden">
        <div className="flex gap-2 sm:gap-3">
          {items.map((item) => (
            <div
              key={item.id}
              className="min-w-0 shrink-0 basis-[44%] sm:basis-[28%] md:basis-[22%] lg:basis-[18%] xl:basis-[14%]"
            >
              <Card item={item} />
            </div>
          ))}
          {hasMore && isFetchingNextPage ? (
            <div className="min-w-0 shrink-0 basis-[44%] sm:basis-[28%] md:basis-[22%] lg:basis-[18%] xl:basis-[14%]">
              <div className="aspect-[2/3] animate-pulse rounded-md bg-muted" />
            </div>
          ) : null}
        </div>
      </div>
      <ArrowButton
        direction="prev"
        disabled={!canPrev}
        onClick={scrollPrev}
        className="left-1 hidden md:[@media(hover:hover)]:flex"
      />
      <ArrowButton
        direction="next"
        disabled={!canNext && !hasMore}
        onClick={scrollNext}
        className="right-1 hidden md:[@media(hover:hover)]:flex"
      />
    </div>
  );
}

interface ArrowButtonProps {
  direction: "prev" | "next";
  disabled: boolean;
  onClick: () => void;
  className?: string;
}

function ArrowButton({ direction, disabled, onClick, className }: ArrowButtonProps) {
  const Icon = direction === "prev" ? ChevronLeftIcon : ChevronRightIcon;
  return (
    <Button
      variant="secondary"
      size="icon"
      tabIndex={-1}
      aria-label={direction === "prev" ? "Previous" : "Next"}
      disabled={disabled}
      onClick={onClick}
      className={`pointer-events-auto absolute top-1/2 -translate-y-1/2 opacity-0 transition group-focus-within/row:opacity-100 group-hover/row:opacity-100 disabled:opacity-0 ${className ?? ""}`}
    >
      <Icon />
    </Button>
  );
}

export { PAGINATION_THRESHOLD };
