import { useEffect, useState } from "react";

const HIDE_DELTA_PX = 200;
const REVEAL_OFFSET_PX = 64;

/**
 * Returns true once the user has scrolled DOWN by at least HIDE_DELTA_PX
 * since the last direction change. Any scroll-up resets to false; near the
 * page top the nav also stays revealed. Used by floating chrome that should
 * step out of the way while reading and reappear when reached for.
 */
export function useHideOnScrollDown(): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let lastY = window.scrollY;
    let ticking = false;
    function update() {
      const y = window.scrollY;
      const delta = y - lastY;
      if (delta < 0) {
        setHidden(false);
        lastY = y;
      } else if (delta >= HIDE_DELTA_PX) {
        setHidden(y > REVEAL_OFFSET_PX);
        lastY = y;
      }
      ticking = false;
    }
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return hidden;
}
