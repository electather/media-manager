import { useRouterState } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { Bookmark, Home, Library } from "lucide-react";
import * as m from "@/paraglide/messages";

export type NavItem = {
  to: "/" | "/library" | "/watchlist";
  label: () => string;
  Icon: LucideIcon;
  activeOptions?: { exact: boolean };
};

export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: () => m.home_nav_home(), Icon: Home, activeOptions: { exact: true } },
  { to: "/library", label: () => m.home_nav_library(), Icon: Library },
  { to: "/watchlist", label: () => m.home_nav_watchlist(), Icon: Bookmark },
];

export function useActiveNavIndex() {
  const location = useRouterState({ select: (s) => s.location.pathname });
  return NAV_ITEMS.findIndex(({ to, activeOptions }) =>
    "exact" in (activeOptions ?? {}) ? location === to : location.startsWith(to),
  );
}
