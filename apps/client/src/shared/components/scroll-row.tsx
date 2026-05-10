import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type CSSProperties,
  type ComponentProps,
  type Ref,
  type RefObject,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRowEdges } from "@/shared/hooks/use-row-edges";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Skeleton } from "@/shared/ui/skeleton";

interface ScrollRowContextValue {
  scopeRef: RefObject<HTMLDivElement | null>;
  setViewport: (el: HTMLElement | null) => void;
  scrollByDir: (dir: -1 | 1) => void;
}

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

function ScrollRowTrack({ className, ...props }: ComponentProps<"ul">) {
  const { setViewport } = useScrollRow();
  return (
    <ul
      ref={setViewport}
      role="list"
      data-slot="scroll-row-track"
      className={cn(
        "row-track m-0 flex list-none snap-x snap-proximity gap-4 overflow-x-auto overscroll-x-contain p-0 ps-0.5",
        className,
      )}
      {...props}
    />
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
  ScrollRow,
  ScrollRowItem,
  ScrollRowNextButton,
  ScrollRowPrevButton,
  ScrollRowSkeleton,
  ScrollRowTrack,
  ScrollRowViewport,
  useScrollRow,
};
