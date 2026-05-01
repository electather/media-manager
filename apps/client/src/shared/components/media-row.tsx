import { ChevronLeft, ChevronRight, CircleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FocusEvent, type ReactNode } from "react";
import { m } from "@/paraglide/messages";
import { MediaCardSkeleton } from "@/shared/components/media-card-skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { cn } from "@/shared/lib/utils";

const PREFETCH_THRESHOLD_CARDS = 6;
const SKELETON_COUNT = 6;
const GAP_PX = 12;
const ARROW_SCROLL_RATIO = 0.85;
const SCROLL_EDGE_SLACK_PX = 32;
const CARD_WIDTH_BACKDROP_PX = 268;
const CARD_WIDTH_POSTER_PX = 184;

type Aspect = "16/9" | "2/3";

type MediaRowItemBase = { id: string };

export type MediaRowProps<TItem extends MediaRowItemBase> = {
  title: string;
  items: readonly TItem[];
  defaultAspect: Aspect;
  isLoading?: boolean;
  hasMore?: boolean;
  partial?: boolean;
  onLoadMore?: () => void;
  renderItem: (item: TItem) => ReactNode;
  className?: string;
};

export function MediaRow<TItem extends MediaRowItemBase>({
  title,
  items,
  defaultAspect,
  isLoading = false,
  hasMore = false,
  partial = false,
  onLoadMore,
  renderItem,
  className,
}: MediaRowProps<TItem>) {
  const trackRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(items.length > 0);
  const [hover, setHover] = useState(false);

  const cardWidth = defaultAspect === "16/9" ? CARD_WIDTH_BACKDROP_PX : CARD_WIDTH_POSTER_PX;

  const update = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setCanPrev(el.scrollLeft > SCROLL_EDGE_SLACK_PX);
    setCanNext(el.scrollLeft < max - SCROLL_EDGE_SLACK_PX);

    if (!onLoadMore || !hasMore || isLoading) return;
    const remainingPx = max - el.scrollLeft;
    const triggerPx = (cardWidth + GAP_PX) * PREFETCH_THRESHOLD_CARDS;
    if (remainingPx < triggerPx) onLoadMore();
  }, [cardWidth, hasMore, isLoading, onLoadMore]);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [update]);

  useEffect(() => {
    update();
  }, [items.length, isLoading, update]);

  const scrollByDirection = (direction: 1 | -1) => {
    const el = trackRef.current;
    if (!el) return;
    const amount = Math.round(el.clientWidth * ARROW_SCROLL_RATIO) * direction;
    el.scrollBy({ left: amount, behavior: "smooth" });
  };

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setHover(false);
  };

  return (
    <section className={cn("relative", className)}>
      <header className="mb-2.5 flex items-center justify-between pr-2">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
          {partial && (
            <Tooltip>
              <TooltipTrigger
                className="inline-flex text-muted-foreground"
                aria-label={m.media_row_partial_tooltip()}
              >
                <CircleAlert className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent>{m.media_row_partial_tooltip()}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </header>

      <div
        ref={wrapRef}
        className="relative"
        onMouseEnter={() => setHover(true)}
        onFocus={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onBlur={handleBlur}
      >
        <div
          ref={trackRef}
          className={cn(
            "-my-7 flex snap-x snap-proximity overflow-x-auto overflow-y-hidden scroll-smooth py-7 pr-7 pl-7",
            "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          )}
          style={{ gap: GAP_PX }}
        >
          {items.map((item) => (
            <div key={item.id} className="snap-start" style={{ flex: `0 0 ${cardWidth}px` }}>
              {renderItem(item)}
            </div>
          ))}
          {isLoading &&
            Array.from({ length: SKELETON_COUNT }).map((_, i) => (
              <div
                key={`skeleton-${i}`}
                className="snap-start"
                style={{ flex: `0 0 ${cardWidth}px` }}
              >
                <MediaCardSkeleton aspect={defaultAspect} />
              </div>
            ))}
        </div>

        <EdgeFade side="left" visible={canPrev} />
        <EdgeFade side="right" visible={canNext} />

        <RowArrow
          side="left"
          ariaLabel={m.media_row_prev_aria({ title })}
          visible={hover && canPrev}
          disabled={!canPrev}
          onClick={() => scrollByDirection(-1)}
        />
        <RowArrow
          side="right"
          ariaLabel={m.media_row_next_aria({ title })}
          visible={hover && canNext}
          disabled={!canNext}
          onClick={() => scrollByDirection(1)}
        />
      </div>
    </section>
  );
}

function EdgeFade({ side, visible }: { side: "left" | "right"; visible: boolean }) {
  return (
    <div
      aria-hidden="true"
      data-visible={visible ? "true" : "false"}
      className={cn(
        "pointer-events-none absolute inset-y-0 z-1 w-12 transition-opacity duration-200 data-[visible=false]:opacity-0",
        side === "left"
          ? "left-0 bg-gradient-to-r from-background to-transparent"
          : "right-0 bg-gradient-to-l from-background to-transparent",
      )}
    />
  );
}

function RowArrow({
  side,
  ariaLabel,
  visible,
  disabled,
  onClick,
}: {
  side: "left" | "right";
  ariaLabel: string;
  visible: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      data-visible={visible ? "true" : "false"}
      className={cn(
        "absolute top-1/2 z-2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-full",
        "border border-border bg-background/80 text-foreground shadow-md backdrop-blur",
        "transition-opacity duration-150 data-[visible=false]:pointer-events-none data-[visible=false]:opacity-0",
        "disabled:cursor-not-allowed disabled:opacity-40",
        side === "left" ? "left-2" : "right-2",
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}
