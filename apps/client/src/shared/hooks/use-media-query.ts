import { useRef, useSyncExternalStore } from "react";

export function useMediaQuery(query: string): boolean {
  const mqRef = useRef<MediaQueryList | null>(null);

  return useSyncExternalStore(
    (cb) => {
      mqRef.current = window.matchMedia(query);
      mqRef.current.addEventListener("change", cb);
      return () => mqRef.current?.removeEventListener("change", cb);
    },
    () => (mqRef.current ?? window.matchMedia(query)).matches,
    () => false,
  );
}
