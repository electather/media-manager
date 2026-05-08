import { Bookmark, Home, Library, Plug, Settings } from "lucide-react";

import type { PageItem } from "../types";

/**
 * Static list of pages the command menu can navigate to. Order matters — it's
 * the order shown when the user has not typed anything. `sequence` registers
 * a vim-style chord (e.g. `g h` → home) consumed by `useCommandHotkeys`.
 */
export const COMMAND_PAGES: readonly PageItem[] = [
  {
    kind: "page",
    id: "page:home",
    to: "/",
    Icon: Home,
    labelKey: "command_menu_page_home_label",
    hintKey: "command_menu_page_home_hint",
    sequence: ["G", "H"],
  },
  {
    kind: "page",
    id: "page:library",
    to: "/library",
    Icon: Library,
    labelKey: "command_menu_page_library_label",
    hintKey: "command_menu_page_library_hint",
    sequence: ["G", "L"],
  },
  {
    kind: "page",
    id: "page:watchlist",
    to: "/watchlist",
    Icon: Bookmark,
    labelKey: "command_menu_page_watchlist_label",
    hintKey: "command_menu_page_watchlist_hint",
    sequence: ["G", "W"],
  },
  {
    kind: "page",
    id: "page:settings",
    to: "/settings",
    Icon: Settings,
    labelKey: "command_menu_page_settings_label",
    hintKey: "command_menu_page_settings_hint",
    sequence: ["G", "S"],
  },
  {
    kind: "page",
    id: "page:connections",
    to: "/settings/connections",
    Icon: Plug,
    labelKey: "command_menu_page_connections_label",
    hintKey: "command_menu_page_connections_hint",
    sequence: ["G", "C"],
  },
] as const;
