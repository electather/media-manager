import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";

/**
 * Returns a stable `onPeek(id)` callback that opens the peek modal by setting
 * `?peek=<id>` in the current route's search params. Centralises the peek
 * navigation contract so all eight section components share one definition and
 * any change to the param name or replace-scroll semantics propagates from here.
 */
export function useWatchlistPeek(): (id: string) => void {
  const navigate = useNavigate();
  return useCallback(
    (id: string) => {
      void navigate({
        to: ".",
        search: (prev) => ({ ...prev, peek: id }),
        replace: false,
        resetScroll: false,
      });
    },
    [navigate],
  );
}
