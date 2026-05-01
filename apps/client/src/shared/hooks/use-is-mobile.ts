import { useRef, useSyncExternalStore } from "react";

const MOBILE_QUERY = "(max-width: 640px)";

export function useIsMobile(): boolean {
  const mqRef = useRef<MediaQueryList | null>(null);

  return useSyncExternalStore(
    (cb) => {
      mqRef.current = window.matchMedia(MOBILE_QUERY);
      mqRef.current.addEventListener("change", cb);
      return () => mqRef.current?.removeEventListener("change", cb);
    },
    () => (mqRef.current ?? window.matchMedia(MOBILE_QUERY)).matches,
    () => false,
  );
}
