import { useSyncExternalStore } from "react";

function subscribe(onStoreChange: () => void) {
  window.addEventListener("scroll", onStoreChange, { passive: true });
  return () => {
    window.removeEventListener("scroll", onStoreChange);
  };
}

/**
 * Tracks `window.scrollY` via `useSyncExternalStore`. Used by the parallax
 * backdrop on the detail page; the rerender per scroll-event is acceptable for
 * a single transformed element and avoids the React-Owns-DOM ratchet of an
 * imperative subscription.
 */
export function useScrollY(): number {
  return useSyncExternalStore(
    subscribe,
    () => window.scrollY,
    () => 0,
  );
}
