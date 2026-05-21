import { useLayoutEffect, useState, type RefObject } from "react";

interface UseGridColumnsArgs {
  minColumnWidthPx: number;
  gapPx: number;
}

/**
 * Mirrors `repeat(auto-fill, minmax(min, 1fr))` in JS so a window-virtualized
 * grid can know how many cells fit per row. Recomputes on width changes via
 * a `ResizeObserver` on the parent element.
 */
export function useGridColumns(
  ref: RefObject<HTMLElement | null>,
  { minColumnWidthPx, gapPx }: UseGridColumnsArgs,
): { cols: number } {
  const [cols, setCols] = useState(1);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const compute = () => {
      const w = el.clientWidth;
      const next = Math.max(1, Math.floor((w + gapPx) / (minColumnWidthPx + gapPx)));
      setCols((prev) => (prev === next ? prev : next));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, minColumnWidthPx, gapPx]);

  return { cols };
}
