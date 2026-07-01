import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ComponentProps,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRowEdges } from "@/shared/hooks/use-row-edges";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Skeleton } from "@/shared/ui/skeleton";

interface ScrollRowContextValue {
  scopeRef: RefObject<HTMLDivElement | null>;
  setViewport: (el: HTMLElement | null) => void;
  scrollByDir: (dir: -1 | 1) => void;
}

/** CSS custom properties that size the cards within a `ScrollRow` track. */
interface CardWidthVars extends CSSProperties {
  "--card-w": string;
  "--card-h": string;
}

/** Poster (2:3) card sizing shared by every poster row. */
const POSTER_VARS: CardWidthVars = { "--card-w": "200px", "--card-h": "300px" };
/** Backdrop (16:9) card sizing shared by every backdrop row. */
const BACKDROP_VARS: CardWidthVars = { "--card-w": "320px", "--card-h": "180px" };

const ScrollRowContext = createContext<ScrollRowContextValue | null>(null);

function useScrollRow(): ScrollRowContextValue {
  const ctx = useContext(ScrollRowContext);
  if (!ctx) throw new Error("ScrollRow components must be used within <ScrollRow>");
  return ctx;
}

interface ScrollRowProps extends ComponentProps<"section"> {
  /** Forwards the inner track element so callers can attach extra wiring (e.g. prefetch sentinel). */
  viewportRef?: Ref<HTMLElement>;
  /** Triggers an edge-state recompute when its identity changes (e.g. item count). */
  revalidationKey?: unknown;
}

/**
 * Editorial horizontally-scrolling row. Composed via slot components
 * (`ScrollRowHeader`, `ScrollRowViewport`, `ScrollRowTrack`, etc.) so the
 * home and library rows share layout, edge fades, and scroll behaviour
 * while owning their own data + content.
 */
function ScrollRow({
  viewportRef: externalViewportRef,
  revalidationKey,
  className,
  children,
  ...props
}: ScrollRowProps) {
  const scopeRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLElement | null>(null);

  const setViewport = useCallback(
    (el: HTMLElement | null) => {
      viewportRef.current = el;
      if (typeof externalViewportRef === "function") externalViewportRef(el);
      else if (externalViewportRef)
        (externalViewportRef as { current: HTMLElement | null }).current = el;
    },
    [externalViewportRef],
  );

  const scrollByDir = useCallback((dir: -1 | 1) => {
    const el = viewportRef.current;
    if (!el) return;
    el.scrollBy({ left: Math.round(el.clientWidth * 0.85) * dir, behavior: "smooth" });
  }, []);

  useRowEdges(viewportRef, scopeRef, revalidationKey);

  const ctx = useMemo<ScrollRowContextValue>(
    () => ({ scopeRef, setViewport, scrollByDir }),
    [setViewport, scrollByDir],
  );

  return (
    <ScrollRowContext.Provider value={ctx}>
      <section data-slot="scroll-row" className={className} {...props}>
        {children}
      </section>
    </ScrollRowContext.Provider>
  );
}

type ScrollRowChevronProps = Omit<ComponentProps<typeof Button>, "onClick" | "variant" | "size">;

function ScrollRowPrevButton({ className, children, ...props }: ScrollRowChevronProps) {
  const { scrollByDir } = useScrollRow();
  return (
    <Button
      data-slot="scroll-row-prev"
      variant="outline"
      size="icon"
      onClick={() => scrollByDir(-1)}
      className={className}
      {...props}
    >
      {children ?? <ChevronLeft aria-hidden="true" className="size-4" />}
    </Button>
  );
}

function ScrollRowNextButton({ className, children, ...props }: ScrollRowChevronProps) {
  const { scrollByDir } = useScrollRow();
  return (
    <Button
      data-slot="scroll-row-next"
      variant="outline"
      size="icon"
      onClick={() => scrollByDir(1)}
      className={className}
      {...props}
    >
      {children ?? <ChevronRight aria-hidden="true" className="size-4" />}
    </Button>
  );
}

function ScrollRowViewport({ className, ...props }: ComponentProps<"div">) {
  const { scopeRef } = useScrollRow();
  return (
    <div
      ref={scopeRef}
      data-slot="scroll-row-viewport"
      data-at-start="true"
      data-at-end="true"
      className={cn("row-track-scope relative", className)}
      {...props}
    />
  );
}

const BASE_TRACK_CLASSES =
  "row-track m-0 flex list-none snap-x snap-proximity gap-4 overflow-x-auto overscroll-x-contain p-0 ps-0.5";

type ScrollRowTrackBaseProps = Omit<ComponentProps<"ul">, "children">;

interface ScrollRowTrackChildrenProps extends ComponentProps<"ul"> {
  virtualize?: false;
}

interface ScrollRowTrackVirtualizedProps<T> extends ScrollRowTrackBaseProps {
  virtualize: true;
  items: readonly T[];
  getKey: (item: T, index: number) => string;
  estimateItemWidth: number;
  renderItem: (item: T, index: number) => ReactNode;
  overscan?: number;
  onRangeChange?: (range: { startIndex: number; endIndex: number }) => void;
  /** Inline gap between items in px. Matches Tailwind `gap-4` on the non-virtualized track. */
  gapPx?: number;
  /**
   * Trailing pagination slot rendered as one extra card-sized item after the
   * list (#888). Pass `<PaginationSlot variant="card" .../>`; it occupies a
   * single `--card-w` slot so the row's height/width stays stable as it swaps
   * loading ↔ error ↔ none. Excluded from the `onRangeChange` prefetch range.
   */
  trailingSlot?: ReactNode;
}

type ScrollRowTrackProps<T> = ScrollRowTrackChildrenProps | ScrollRowTrackVirtualizedProps<T>;

function ScrollRowTrack<T>(props: ScrollRowTrackProps<T>) {
  if (props.virtualize) return <VirtualizedScrollRowTrack {...props} />;
  const { className, ...rest } = props;
  return <NonVirtualizedScrollRowTrack className={className} {...rest} />;
}

function NonVirtualizedScrollRowTrack({ className, ...props }: ComponentProps<"ul">) {
  const { setViewport } = useScrollRow();
  return (
    <ul
      ref={setViewport}
      role="list"
      data-slot="scroll-row-track"
      className={cn(BASE_TRACK_CLASSES, className)}
      {...props}
    />
  );
}

// fallow-ignore-next-line complexity
function VirtualizedScrollRowTrack<T>({
  items,
  getKey,
  estimateItemWidth,
  renderItem,
  overscan = 4,
  onRangeChange,
  gapPx = 16,
  className,
  trailingSlot,
  // The `virtualize` discriminator is intentionally stripped before spread.
  virtualize: _virtualize,
  ...rest
}: ScrollRowTrackVirtualizedProps<T>) {
  const { setViewport } = useScrollRow();
  const trackRef = useRef<HTMLUListElement | null>(null);
  const setRef = useCallback(
    (el: HTMLUListElement | null) => {
      trackRef.current = el;
      setViewport(el);
    },
    [setViewport],
  );

  const hasSlot = trailingSlot != null;
  const virtualizer = useVirtualizer({
    horizontal: true,
    count: items.length + (hasSlot ? 1 : 0),
    getScrollElement: () => trackRef.current,
    estimateSize: () => estimateItemWidth + gapPx,
    overscan,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const startIndex = virtualItems[0]?.index ?? -1;
  const endIndex = virtualItems[virtualItems.length - 1]?.index ?? -1;

  useEffect(() => {
    if (startIndex < 0) return;
    // Clamp to real items so the trailing slot never inflates the prefetch range.
    const lastReal = items.length - 1;
    onRangeChange?.({ startIndex, endIndex: Math.min(endIndex, lastReal) });
  }, [startIndex, endIndex, items.length, onRangeChange]);

  return (
    <ul
      ref={setRef}
      role="list"
      data-slot="scroll-row-track"
      data-virt="true"
      className={cn(BASE_TRACK_CLASSES, className)}
      style={{ minBlockSize: "calc(var(--card-h) + 4rem)", overflowY: "hidden" }}
      {...rest}
    >
      <li aria-hidden="true" style={{ inlineSize: totalSize, blockSize: 1, flexShrink: 0 }} />
      {virtualItems.map((vi) => {
        const item = items[vi.index];
        const isSlot = hasSlot && vi.index >= items.length;
        const key = isSlot
          ? "pagination-slot"
          : item
            ? getKey(item, vi.index)
            : `empty-${vi.index}`;
        return (
          <VirtualTrackItem key={key} start={vi.start} index={vi.index}>
            {renderTrackChild(isSlot, trailingSlot, item, vi.index, renderItem)}
          </VirtualTrackItem>
        );
      })}
    </ul>
  );
}

/** Picks the trailing slot, the item, or nothing for one virtual index. */
function renderTrackChild<T>(
  isSlot: boolean,
  trailingSlot: ReactNode,
  item: T | undefined,
  index: number,
  renderItem: (item: T, index: number) => ReactNode,
): ReactNode {
  if (isSlot) return trailingSlot;
  if (item === undefined) return null;
  return renderItem(item, index);
}

/** One absolutely-positioned card slot in the virtualized horizontal track. */
function VirtualTrackItem({
  start,
  index,
  children,
}: {
  start: number;
  index: number;
  children: ReactNode;
}) {
  return (
    <li
      // No `ref={virtualizer.measureElement}` — keeps the virtualizer in fixed-size mode so `estimateItemWidth` drives positioning and the gap between cards is preserved.
      data-slot="scroll-row-item"
      data-index={index}
      className="shrink-0 snap-start"
      style={{
        position: "absolute",
        insetBlockStart: 0,
        insetInlineStart: start,
        width: "var(--card-w)",
      }}
    >
      {children}
    </li>
  );
}

function ScrollRowItem({ className, style, ...props }: ComponentProps<"li">) {
  return (
    <li
      data-slot="scroll-row-item"
      className={cn("shrink-0 snap-start", className)}
      style={
        {
          width: "var(--card-w)",
          contentVisibility: "auto",
          containIntrinsicSize: "auto var(--card-w) auto var(--card-h)",
          ...style,
        } as CSSProperties
      }
      {...props}
    />
  );
}

interface ScrollRowSkeletonProps extends ComponentProps<"li"> {
  aspect: "16/9" | "2/3";
}

function ScrollRowSkeleton({ aspect, className, ...props }: ScrollRowSkeletonProps) {
  return (
    <li
      aria-hidden="true"
      data-slot="scroll-row-skeleton"
      className={cn("flex shrink-0 snap-start flex-col gap-2", className)}
      style={{ width: "var(--card-w)" }}
      {...props}
    >
      <Skeleton
        className={cn("w-full rounded-md", aspect === "16/9" ? "aspect-video" : "aspect-2/3")}
      />
      <Skeleton className="h-3 w-3/4 rounded" />
      <Skeleton className="h-3 w-1/2 rounded" />
    </li>
  );
}

export {
  BACKDROP_VARS,
  POSTER_VARS,
  ScrollRow,
  ScrollRowItem,
  ScrollRowNextButton,
  ScrollRowPrevButton,
  ScrollRowSkeleton,
  ScrollRowTrack,
  ScrollRowViewport,
  useScrollRow,
};
