import { Keyboard } from "lucide-react";

import type { ActionItem } from "../types";

/**
 * Static action contributions. Settings (theme, locale) live under their own
 * `setting` kind — actions here are one-shot commands like "show shortcuts".
 */
export const COMMAND_ACTIONS: readonly ActionItem[] = [
  {
    kind: "action",
    id: "act:show-shortcuts",
    Icon: Keyboard,
    labelKey: "command_menu_action_show_shortcuts_label",
    hintKey: "command_menu_action_show_shortcuts_hint",
    hotkey: "Mod+/",
    run: (ctx) => ctx.push({ kind: "cheatsheet" }),
  },
] as const;
