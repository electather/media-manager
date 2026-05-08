import { Film, Tv } from "lucide-react";

import type { SearchModeItem } from "../types";

/**
 * Top-level "I want to search shows / movies" rows. Selecting one flips the
 * menu into a scope-filtered mode without dismissing it.
 */
export const COMMAND_SEARCH_MODES: readonly SearchModeItem[] = [
  {
    kind: "search-mode",
    id: "search:tv",
    scope: "tv",
    Icon: Tv,
    labelKey: "command_menu_search_tv_label",
    hintKey: "command_menu_search_tv_hint",
  },
  {
    kind: "search-mode",
    id: "search:movie",
    scope: "movie",
    Icon: Film,
    labelKey: "command_menu_search_movie_label",
    hintKey: "command_menu_search_movie_hint",
  },
] as const;
