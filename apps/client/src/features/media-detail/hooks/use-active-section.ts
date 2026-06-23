import { useEffect, useState } from "react";

/** Tracks which section is above sticky-nav trigger line. Uses rAF + bounding rects instead of IntersectionObserver (handles instant scrolls and crossings). */
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
      // they're too short to push their top past the trigger line. Skipped
      // for non-scrollable pages (e.g. sparse movie page on a tall display)
      // so we don't immediately mark the last section as active at rest.
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      if (maxScroll > 0 && window.scrollY >= maxScroll - 4) {
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
