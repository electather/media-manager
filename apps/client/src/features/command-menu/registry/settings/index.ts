import type { SettingItem } from "../../types";
import { LOCALE_SETTING } from "./locale";
import { THEME_SETTING } from "./theme";

export { THEME_SETTING, type ThemeName } from "./theme";
export { LOCALE_SETTING } from "./locale";

/**
 * Static catalog of every settings contribution. Order is the render order
 * inside the "Settings" group on the root frame. Read/write are bound at
 * render time via `useBoundSettings()`.
 */
export const COMMAND_SETTINGS = [
  THEME_SETTING,
  LOCALE_SETTING,
] as const satisfies readonly SettingItem<string>[];
