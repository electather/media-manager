import { useEffect, useState } from "react";

/**
 * Tracks which section heading is closest to the top of the viewport so the
 * sticky in-page nav can highlight the active anchor. Uses an
 * `IntersectionObserver` with a top-rooted margin matching the reserved space
 * for the global nav + section nav stack.
 */
export function useActiveSection(sectionIds: readonly string[], topOffsetPx: number): string {
  const [active, setActive] = useState(sectionIds[0] ?? "");

  useEffect(() => {
    if (sectionIds.length === 0) return;
    const elements = sectionIds
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target.id) setActive(visible[0].target.id);
      },
      {
        rootMargin: `-${topOffsetPx}px 0px -55% 0px`,
        threshold: 0,
      },
    );

    for (const el of elements) observer.observe(el);
    return () => observer.disconnect();
  }, [sectionIds, topOffsetPx]);

  return active;
}
