import { Monitor, Moon, Sparkles, Sun } from "lucide-react";

import type { SettingItem } from "../../types";

export const THEMES = ["system", "light", "dark"] as const;
export type ThemeName = (typeof THEMES)[number];

/**
 * Theme picker contribution. `read` / `write` are placeholders here — the menu
 * binds them to the app theme provider at runtime via `useBoundSettings()` so
 * the registry stays free of React hooks. Typed as `SettingItem<string>` so
 * the heterogenous `COMMAND_SETTINGS` array unifies; the bind site narrows
 * back via the `THEMES` constant.
 */
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
