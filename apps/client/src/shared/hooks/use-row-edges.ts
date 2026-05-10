import { useEffect, type RefObject } from "react";

const EDGE_SLACK_PX = 8;

/**
 * Toggles `data-at-start` / `data-at-end` data-attrs on the scope element
 * via an rAF-throttled scroll listener + ResizeObserver. Re-runs when
 * `revalidationKey` changes so scrollWidth changes (e.g. items appended)
 * are picked up immediately. RTL is handled by the browser flipping
 * `scrollLeft` sign; `Math.abs()` normalises it.
 */
export function useRowEdges(
  trackRef: RefObject<HTMLElement | null>,
  scopeRef: RefObject<HTMLElement | null>,
  revalidationKey: unknown = null,
): void {
  useEffect(() => {
    const track = trackRef.current;
    const scope = scopeRef.current;
    if (!track || !scope) return;

    let raf = 0;
    const update = () => {
      raf = 0;
      const max = track.scrollWidth - track.clientWidth;
      const x = Math.abs(track.scrollLeft);
      scope.dataset.atStart = String(x <= EDGE_SLACK_PX);
      scope.dataset.atEnd = String(max <= 0 || x >= max - EDGE_SLACK_PX);
    };
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(update);
    };

    update();
    track.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(track);

    return () => {
      track.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [revalidationKey, trackRef, scopeRef]);
}
