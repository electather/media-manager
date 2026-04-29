import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback } from "react";

import { PEEK_ID_REGEX } from "./home-display";

export function usePeekParam(): string | null {
  const search = useSearch({ strict: false }) as { peek?: string };
  if (typeof search.peek !== "string") return null;
  if (!PEEK_ID_REGEX.test(search.peek)) return null;
  return search.peek;
}

export function useOpenPeek(): (mediaId: string) => void {
  const navigate = useNavigate();
  return useCallback(
    (mediaId: string) => {
      void navigate({
        to: ".",
        search: (prev) => ({ ...(prev as Record<string, unknown>), peek: mediaId }),
        replace: false,
      });
    },
    [navigate],
  );
}

export function useClosePeek(): () => void {
  const navigate = useNavigate();
  return useCallback(() => {
    void navigate({
      to: ".",
      search: (prev) => {
        const next = { ...(prev as Record<string, unknown>) };
        delete next.peek;
        return next;
      },
    });
  }, [navigate]);
}
