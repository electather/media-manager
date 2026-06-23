const DEFAULT_NAV_STACK_PX = 150;

// Reads --detail-section-nav-stack CSS var for offset; falls back during SSR when var is missing.
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
