import { Bookmark, Home, Library, Plug, Settings } from "lucide-react";

import type { PageItem } from "../types";

/**
 * Static list of pages the command menu can navigate to. Order matters — it's
 * the order shown when the user has not typed anything.
 */
export const COMMAND_PAGES: readonly PageItem[] = [
  {
    id: "page:home",
    to: "/",
    Icon: Home,
    labelKey: "command_menu_page_home_label",
    hintKey: "command_menu_page_home_hint",
  },
  {
    id: "page:library",
    to: "/library",
    Icon: Library,
    labelKey: "command_menu_page_library_label",
    hintKey: "command_menu_page_library_hint",
  },
  {
    id: "page:watchlist",
    to: "/watchlist",
    Icon: Bookmark,
    labelKey: "command_menu_page_watchlist_label",
    hintKey: "command_menu_page_watchlist_hint",
  },
  {
    id: "page:settings",
    to: "/settings",
    Icon: Settings,
    labelKey: "command_menu_page_settings_label",
    hintKey: "command_menu_page_settings_hint",
  },
  {
    id: "page:connections",
    to: "/settings/connections",
    Icon: Plug,
    labelKey: "command_menu_page_connections_label",
    hintKey: "command_menu_page_connections_hint",
  },
] as const;
