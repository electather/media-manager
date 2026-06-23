import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";

// Stable onPeek(id) callback that opens peek modal via ?peek=<id> search param.
// Centralizes navigation contract across all eight section components.
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
