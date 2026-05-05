import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import {
  generateMockPage,
  MAX_MOCK_ITEMS,
  MOCK_PAGE_SIZE,
  PREFETCH_THRESHOLD,
} from "../lib/mock-pagination";
import type { HomeMediaItem, RowData } from "../lib/types";

interface UseMockPaginationResult {
  items: HomeMediaItem[];
  exhausted: boolean;
  /**
   * Index of the item to attach `prefetchRef` to. -1 once the row is
   * exhausted or while no items are loaded.
   */
  prefetchIndex: number;
  /**
   * Set this on the scroll container element so the IO can root against it.
   */
  attachTrack: (el: HTMLElement | null) => void;
  /**
   * Set this on the prefetch sentinel item — fires `loadMore` when it
   * intersects the track.
   */
  prefetchRef: (el: HTMLElement | null) => void;
}

/**
 * Mock infinite-scroll pagination for a row. Resets when the row identity
 * changes (the parent should also `key` the consumer on row.id to be safe).
 *
 * Uses an IntersectionObserver on a sentinel item placed `PREFETCH_THRESHOLD`
 * cards before the end. The observer is rooted against the track element and
 * fires while the user is mid-scroll (no waiting for `scrollend`), so the
 * next page mounts before the user reaches the last visible card.
 *
 * The sentinel moves as items grow, so the observer is detached and
 * re-attached on each ref change. The cost is negligible (one IO per page
 * fetch) and the off-thread intersection check is cheaper than a per-frame
 * scroll listener at idle scroll positions.
 */
export function useMockPagination(row: RowData): UseMockPaginationResult {
  const [items, setItems] = useState<HomeMediaItem[]>(row.items);
  const [exhausted, setExhausted] = useState(row.items.length === 0);
  const trackElRef = useRef<HTMLElement | null>(null);
  const prefetchElRef = useRef<HTMLElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const loadMore = useCallback(() => {
    startTransition(() => {
      setItems((prev) => {
        if (prev.length >= MAX_MOCK_ITEMS) {
          setExhausted(true);
          return prev;
        }
        const more = generateMockPage(prev, MOCK_PAGE_SIZE);
        const next = prev.concat(more).slice(0, MAX_MOCK_ITEMS);
        if (next.length >= MAX_MOCK_ITEMS) setExhausted(true);
        return next;
      });
    });
  }, []);

  // Re-create the observer whenever either ref changes or pagination
  // exhausts. We can't use `useEffect` with the refs as deps because ref
  // assignments don't trigger renders, so the ref-callback drives this
  // imperatively instead.
  const wireObserver = useCallback(() => {
    observerRef.current?.disconnect();
    observerRef.current = null;

    const track = trackElRef.current;
    const sentinel = prefetchElRef.current;
    if (!track || !sentinel || exhausted) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) loadMore();
        }
      },
      { root: track, threshold: 0 },
    );
    io.observe(sentinel);
    observerRef.current = io;
  }, [exhausted, loadMore]);

  const attachTrack = useCallback(
    (el: HTMLElement | null) => {
      trackElRef.current = el;
      wireObserver();
    },
    [wireObserver],
  );

  const prefetchRef = useCallback(
    (el: HTMLElement | null) => {
      prefetchElRef.current = el;
      wireObserver();
    },
    [wireObserver],
  );

  // Tear the observer down on unmount.
  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, []);

  // Reset when the row identity changes. Parents that pass `key={row.id}` on
  // the consuming component already re-mount, but this guards direct reuse.
  useEffect(() => {
    setItems(row.items);
    setExhausted(row.items.length === 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id]);

  const prefetchIndex =
    exhausted || items.length === 0 ? -1 : Math.max(0, items.length - PREFETCH_THRESHOLD);

  return { items, exhausted, prefetchIndex, attachTrack, prefetchRef };
}
