import { Monitor, Moon, Sparkles, Sun } from "lucide-react";

import type { SettingItem } from "../../types";

export const THEMES = ["system", "light", "dark"] as const;
export type ThemeName = (typeof THEMES)[number];

/** `read`/`write` are placeholder stubs; bound to theme provider at runtime via `useBoundSettings()` to avoid hooks in registry. */
export const THEME_SETTING: SettingItem<string> = {
  kind: "setting",
  id: "setting:theme",
  Icon: Sparkles,
  labelKey: "command_menu_setting_theme_label",
  hintKey: "command_menu_setting_theme_hint",
  hotkey: "Mod+Alt+T",
  options: [
    { id: "system", Icon: Monitor, labelKey: "theme_system_label" },
    { id: "light", Icon: Sun, labelKey: "theme_light_label" },
    { id: "dark", Icon: Moon, labelKey: "theme_dark_label" },
  ],
  read: () => "system",
  write: () => {},
};
