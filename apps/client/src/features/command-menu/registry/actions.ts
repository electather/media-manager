import { Keyboard, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { m } from "@/paraglide/messages";

import type { ActionItem } from "../types";

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
