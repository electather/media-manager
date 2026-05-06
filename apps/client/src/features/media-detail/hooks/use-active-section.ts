import { useEffect, useState } from "react";

/**
 * Tracks which in-page section is above the sticky-nav trigger line so the
 * section nav highlights the correct anchor.
 *
 * We pick the last (deepest in DOM order) section whose top has crossed the
 * trigger line. State is recomputed on scroll/resize, throttled to one read
 * per frame via rAF. We tried `IntersectionObserver` first but it fights
 * this UI: a thin slice at the trigger line is skipped on instant scrolls,
 * and a wide band misses crossings that happen while the section is still
 * intersecting. Recomputing 5 bounding rects per frame is well under the
 * cost of either workaround.
 */
export function useActiveSection(sectionIds: readonly string[], topOffsetPx: number): string {
  const [active, setActive] = useState(sectionIds[0] ?? "");

  useEffect(() => {
    if (sectionIds.length === 0) return;
    const elements = sectionIds
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    const update = () => {
      let current = sectionIds[0] ?? "";
      for (const el of elements) {
        if (el.getBoundingClientRect().top <= topOffsetPx) current = el.id;
      }
      // Page-bottom snap: ensures tail sections still light up even when
      // they're too short to push their top past the trigger line.
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      if (window.scrollY >= maxScroll - 4) {
        current = sectionIds[sectionIds.length - 1] ?? current;
      }
      setActive((prev) => (prev === current ? prev : current));
    };

    update();
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        update();
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [sectionIds, topOffsetPx]);

  return active;
}
