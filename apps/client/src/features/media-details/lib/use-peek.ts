import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback } from "react";

// Reads the `?peek=<kind>:<id>` URL search param at the _authenticated layout.
// Use `openPeek(id)` to push (so back-button dismisses), `closePeek()` to replace.
export function usePeek() {
  const search = useSearch({ from: "/_authenticated" }) as { peek?: string };
  const navigate = useNavigate();

  const openPeek = useCallback(
    (id: string) => {
      navigate({
        to: ".",
        search: (prev: Record<string, unknown>) => ({ ...prev, peek: id }),
        replace: false,
      });
    },
    [navigate],
  );

  const closePeek = useCallback(() => {
    navigate({
      to: ".",
      search: (prev: Record<string, unknown>) => {
        const { peek: _omit, ...rest } = prev;
        return rest;
      },
      replace: true,
    });
  }, [navigate]);

  return { peekId: search.peek ?? null, openPeek, closePeek };
}
