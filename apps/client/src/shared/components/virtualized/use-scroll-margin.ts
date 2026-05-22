import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * Tracks an element's document-absolute top as the virtualizer's `scrollMargin`.
 * Uses `getBoundingClientRect().top + window.scrollY` (not `offsetTop`) so the
 * value stays correct when the element is nested inside a positioned ancestor
 * (e.g. a `VirtualWindowList` virtual item, which is `position: absolute`).
 * Re-reads on any body resize so sticky-header / hero-zone resizes don't
 * desync the translateY math.
 */
export function useScrollMargin(ref: RefObject<HTMLElement | null>): number {
  const [scrollMargin, setScrollMargin] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => {
      const rect = el.getBoundingClientRect();
      setScrollMargin(rect.top + window.scrollY);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, []);

  return scrollMargin;
}
