const DEFAULT_NAV_STACK_PX = 150;

/**
 * Single source of truth for the scroll-jump landing offset and the
 * active-section trigger line. Derived from the `--detail-section-nav-stack`
 * CSS var so a sticky-nav redesign updates both at once. Falls back to a
 * sensible default when the var is missing (e.g. during SSR snapshots).
 */
export function readNavStackPx(): number {
  if (typeof window === "undefined") return DEFAULT_NAV_STACK_PX;
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue("--detail-section-nav-stack")
    .trim();
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_NAV_STACK_PX;
}

export function scrollToSection(id: string, offsetPx: number): void {
  const target = document.getElementById(id);
  if (!target) return;
  const top = target.getBoundingClientRect().top + window.scrollY - offsetPx;
  window.scrollTo({ top, behavior: "smooth" });
}
