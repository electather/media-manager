import { Bookmark, Home, Library, Search, type LucideIcon } from "lucide-react";

export type NavItemId = "home" | "search" | "library" | "watchlist";

export interface NavItem {
  id: NavItemId;
  label: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "search", label: "Search", icon: Search },
  { id: "library", label: "Library", icon: Library },
  { id: "watchlist", label: "Watchlist", icon: Bookmark },
];
