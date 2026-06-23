import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * Tracks element's document-absolute top for virtualizer's `scrollMargin`.
 * Uses `getBoundingClientRect().top + window.scrollY` (not offsetTop) for positioned ancestors.
 * Re-reads on body resize to keep sticky-header/hero-zone resizes in sync with translateY.
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
