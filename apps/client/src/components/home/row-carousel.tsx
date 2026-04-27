import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type { CompactMediaItem, RowKind } from "@ent-mcp/shared/home";
import { cn } from "@/lib/utils";
import { ROW_DISPLAY } from "@/lib/home-display";
import { Card } from "./card";

export interface RowCarouselProps {
  rowId: RowKind;
  items: CompactMediaItem[];
  hasMore: boolean;
  isFetching: boolean;
  onNearEnd: () => void;
}

const NEAR_END_THRESHOLD = 0.75;
const NEAR_END_DEBOUNCE_MS = 150;

export function RowCarousel({ rowId, items, hasMore, isFetching, onNearEnd }: RowCarouselProps) {
  // Slide width is keyed off the row's display config (V30: ROW_DISPLAY is
  // the single source of truth for layout), not per-item shape.
  const aspectRatio = ROW_DISPLAY[rowId].aspectRatio;
  const [emblaRef, emblaApi] = useEmblaCarousel({
    dragFree: true,
    containScroll: "trimSnaps",
    slidesToScroll: "auto",
    align: "start",
    loop: false,
  });
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateScrollState = useCallback(() => {
    if (!emblaApi) return;
    setCanScrollPrev(emblaApi.canScrollPrev());
    setCanScrollNext(emblaApi.canScrollNext() || hasMore);
  }, [emblaApi, hasMore]);

  useEffect(() => {
    if (!emblaApi) return;
    updateScrollState();
    emblaApi.on("select", updateScrollState);
    emblaApi.on("reInit", updateScrollState);
    return () => {
      emblaApi.off("select", updateScrollState);
      emblaApi.off("reInit", updateScrollState);
    };
  }, [emblaApi, updateScrollState]);

  useEffect(() => {
    if (!emblaApi) return;
    const onScroll = () => {
      const progress = emblaApi.scrollProgress();
      if (progress < NEAR_END_THRESHOLD) return;
      if (!hasMore || isFetching) return;
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        onNearEnd();
      }, NEAR_END_DEBOUNCE_MS);
    };
    emblaApi.on("scroll", onScroll);
    return () => {
      emblaApi.off("scroll", onScroll);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [emblaApi, hasMore, isFetching, onNearEnd]);

  const scrollPrev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi]);

  function handleCardKey(event: KeyboardEvent<HTMLDivElement>, idx: number) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const next = event.key === "ArrowRight" ? idx + 1 : idx - 1;
    const target = event.currentTarget.parentElement?.children[next] as HTMLElement | undefined;
    // Production selector: cards expose `data-card-link` independently of
    // any test attribute, so keyboard nav stays decoupled from test tooling.
    const link = target?.querySelector<HTMLAnchorElement>("a[data-card-link]");
    if (link) {
      link.focus();
      emblaApi?.scrollTo(next);
    }
  }

  return (
    <div className="group/row relative">
      <button
        type="button"
        onClick={scrollPrev}
        disabled={!canScrollPrev}
        tabIndex={-1}
        aria-label="Scroll left"
        className={cn(
          "absolute left-0 top-1/2 z-10 hidden -translate-y-1/2 -translate-x-1/2 items-center justify-center rounded-full bg-background/85 p-2 shadow-md backdrop-blur-sm transition-opacity",
          "opacity-0 group-hover/row:opacity-100 focus-within:opacity-100",
          "disabled:opacity-0 disabled:pointer-events-none",
          "[@media(hover:none)]:hidden",
          "md:flex",
        )}
      >
        <ChevronLeftIcon className="size-5" />
      </button>

      <div ref={emblaRef} className="overflow-hidden">
        <div className="flex gap-2 sm:gap-3 pr-6">
          {items.map((item, idx) => (
            <div
              key={item.id}
              onKeyDown={(e) => handleCardKey(e, idx)}
              className="shrink-0 basis-[128px] sm:basis-[140px] md:basis-[160px] xl:basis-[180px] data-[aspect=backdrop]:basis-[220px] data-[aspect=backdrop]:md:basis-[250px] data-[aspect=backdrop]:xl:basis-[280px]"
              data-aspect={aspectRatio === "backdrop" ? "backdrop" : undefined}
            >
              <Card item={item} rowId={rowId} size="row" />
            </div>
          ))}
          {isFetching ? (
            <div className="shrink-0 basis-[128px] sm:basis-[140px] md:basis-[160px] xl:basis-[180px]">
              <div className="aspect-[2/3] w-full animate-pulse rounded-md bg-muted/40" />
            </div>
          ) : null}
        </div>
      </div>

      <button
        type="button"
        onClick={scrollNext}
        disabled={!canScrollNext}
        tabIndex={-1}
        aria-label="Scroll right"
        className={cn(
          "absolute right-0 top-1/2 z-10 hidden -translate-y-1/2 translate-x-1/2 items-center justify-center rounded-full bg-background/85 p-2 shadow-md backdrop-blur-sm transition-opacity",
          "opacity-0 group-hover/row:opacity-100 focus-within:opacity-100",
          "disabled:opacity-0 disabled:pointer-events-none",
          "[@media(hover:none)]:hidden",
          "md:flex",
        )}
      >
        <ChevronRightIcon className="size-5" />
      </button>
    </div>
  );
}
