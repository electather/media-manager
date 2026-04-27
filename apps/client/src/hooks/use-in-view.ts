import { useEffect, useState, type RefObject } from "react";

export interface UseInViewOptions {
  /**
   * IntersectionObserver root margin. Defaults to 200px so cards begin
   * loading just before they scroll into view, smoothing the user's
   * perceived latency.
   */
  rootMargin?: string;
}

/**
 * Returns true once the referenced element has intersected the viewport.
 * The hook is one-shot: it never flips back to false after the first
 * intersection, so leaving the viewport doesn't cancel an in-flight fetch
 * or re-trigger one when the element scrolls back in.
 */
export function useInView(ref: RefObject<Element | null>, opts: UseInViewOptions = {}): boolean {
  const [inView, setInView] = useState<boolean>(false);

  useEffect(() => {
    if (inView) return;
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            observer.disconnect();
            return;
          }
        }
      },
      { rootMargin: opts.rootMargin ?? "200px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, inView, opts.rootMargin]);

  return inView;
}
