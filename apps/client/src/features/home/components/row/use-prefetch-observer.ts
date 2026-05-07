import { useCallback, useEffect, useRef, type RefObject } from "react";

interface UsePrefetchObserverParams {
  hasNextPage: boolean;
  fetchNextPage: () => void;
}

interface UsePrefetchObserverResult {
  trackRef: RefObject<HTMLDivElement | null>;
  attachTrack: (el: HTMLDivElement | null) => void;
  attachPrefetch: (el: HTMLLIElement | null) => void;
}

/**
 * IntersectionObserver wiring for the row's prefetch sentinel. Returns the
 * track ref (for imperative scroll calls) plus stable callback-refs to
 * attach to the scroll container and the sentinel `<li>`. The observer
 * rewires whenever either element re-mounts, when `hasNextPage` flips, or
 * when `fetchNextPage` changes.
 */
export function usePrefetchObserver({
  hasNextPage,
  fetchNextPage,
}: UsePrefetchObserverParams): UsePrefetchObserverResult {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLLIElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const wire = useCallback(() => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    const track = trackRef.current;
    const sentinel = sentinelRef.current;
    if (!track || !sentinel || !hasNextPage) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) fetchNextPage();
      },
      { root: track, threshold: 0 },
    );
    io.observe(sentinel);
    observerRef.current = io;
  }, [fetchNextPage, hasNextPage]);

  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, []);

  const attachTrack = useCallback(
    (el: HTMLDivElement | null) => {
      trackRef.current = el;
      wire();
    },
    [wire],
  );

  const attachPrefetch = useCallback(
    (el: HTMLLIElement | null) => {
      sentinelRef.current = el;
      wire();
    },
    [wire],
  );

  return { trackRef, attachTrack, attachPrefetch };
}
