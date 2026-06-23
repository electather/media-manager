import { useEffect, useRef } from "react";

// Calls callback every delayMs while mounted. Pass null for delayMs to pause
// without unmounting. Latest callback always invoked; consumers don't need memoization.
export function useInterval(callback: () => void, delayMs: number | null): void {
  const cbRef = useRef(callback);

  useEffect(() => {
    cbRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delayMs === null) return;
    const id = window.setInterval(() => cbRef.current(), delayMs);
    return () => window.clearInterval(id);
  }, [delayMs]);
}
