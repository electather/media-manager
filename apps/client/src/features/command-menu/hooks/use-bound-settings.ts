import { useTheme } from "next-themes";
import { useMemo } from "react";

import { getLocale, locales, setLocale } from "@/paraglide/runtime";

import { COMMAND_SETTINGS } from "../registry/settings";
import { type ThemeName, THEMES } from "../registry/settings/theme";
import type { SettingItem } from "../types";

type Locale = (typeof locales)[number];

function isTheme(value: string | undefined): value is ThemeName {
  return THEMES.includes(value as ThemeName);
}

/**
 * Returns the static settings catalog with `read` / `write` bound to runtime
 * helpers (`next-themes`, Paraglide). Keeping the binding here lets the
 * registry stay free of React hooks while the menu still picks up the live
 * value when re-rendering.
 */
export function useBoundSettings(): readonly SettingItem<string>[] {
  const { theme, resolvedTheme, setTheme } = useTheme();
  // `getLocale()` is a non-reactive read. Safe here only because Paraglide's
  // `setLocale` triggers a full page reload by default, which remounts this
  // hook with the fresh value — the memo would *not* re-run otherwise.
  const currentLocale = getLocale();

  return useMemo(() => {
    return COMMAND_SETTINGS.map((setting): SettingItem<string> => {
      if (setting.id === "setting:theme") {
        return {
          ...setting,
          read: () => {
            const candidate = theme ?? resolvedTheme;
            return isTheme(candidate) ? candidate : "system";
          },
          write: (next) => setTheme(next),
        };
      }
      if (setting.id === "setting:locale") {
        return {
          ...setting,
          read: () => currentLocale,
          // `setLocale` triggers a full reload by default — that picks up the
          // new translations everywhere without us having to teach React's
          // tree to react to a changed `getLocale()` value.
          write: (next) => setLocale(next as Locale),
        };
      }
      return setting;
    });
  }, [currentLocale, resolvedTheme, setTheme, theme]);
}
