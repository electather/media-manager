import type { MouseEvent } from "react";
import { useRouter } from "@tanstack/react-router";

export function usePeekClick(itemId: string) {
  const router = useRouter();
  return function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1) return;
    event.preventDefault();
    void router.navigate({
      to: ".",
      search: (prev) => ({ ...(prev as Record<string, unknown>), peek: itemId }),
      replace: false,
    });
  };
}
