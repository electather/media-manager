import {
  Bookmark,
  Film,
  Home,
  Keyboard,
  Library,
  Plug,
  Settings,
  Sparkles,
  Tv,
} from "lucide-react";
import { toast } from "sonner";

import { m } from "@/paraglide/messages";

import type { ActionItem, PageItem, SearchModeItem } from "./types";

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

/**
 * Top-level "I want to search shows / movies" rows. Selecting one flips the
 * menu into a scope-filtered mode without dismissing it.
 */
export const COMMAND_SEARCH_MODES: readonly SearchModeItem[] = [
  {
    id: "search:tv",
    scope: "tv",
    Icon: Tv,
    labelKey: "command_menu_search_tv_label",
    hintKey: "command_menu_search_tv_hint",
  },
  {
    id: "search:movie",
    scope: "movie",
    Icon: Film,
    labelKey: "command_menu_search_movie_label",
    hintKey: "command_menu_search_movie_hint",
  },
] as const;

const THEME_CYCLE = ["system", "light", "dark"] as const;
export type ThemeName = (typeof THEME_CYCLE)[number];

export function nextTheme(current: string | undefined): ThemeName {
  // Treat a missing theme as the start of the cycle so the user advances to
  // the next slot. Unknown values fall through to "system" instead of
  // wrapping into an arbitrary cycle position.
  const idx = THEME_CYCLE.indexOf((current ?? "system") as ThemeName);
  if (idx < 0) return "system";
  return THEME_CYCLE[(idx + 1) % THEME_CYCLE.length] as ThemeName;
}

/**
 * Build the action list. Actions hold a closure over runtime helpers (theme
 * setter, etc.) so they can be invoked outside React without prop-drilling.
 */
export function buildCommandActions(opts: {
  setTheme: (theme: string) => void;
  resolveTheme: () => string | undefined;
}): ActionItem[] {
  return [
    {
      id: "act:toggle-theme",
      Icon: Sparkles,
      labelKey: "command_menu_action_toggle_theme_label",
      hintKey: "command_menu_action_toggle_theme_hint",
      run: () => {
        const next = nextTheme(opts.resolveTheme());
        opts.setTheme(next);
        toast.success(m.command_menu_action_toggle_theme_toast({ theme: next }));
      },
    },
    {
      id: "act:keyboard-help",
      Icon: Keyboard,
      labelKey: "command_menu_action_keyboard_help_label",
      hintKey: "command_menu_action_keyboard_help_hint",
      run: () => {
        toast.info(m.command_menu_action_keyboard_help_toast());
      },
    },
  ];
}
