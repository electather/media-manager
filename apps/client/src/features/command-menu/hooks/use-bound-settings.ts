import { useTheme } from "next-themes";
import { useMemo } from "react";

import { getLocale, locales, setLocale } from "@/paraglide/runtime";
import { applyLocaleStyling } from "@/shared/lib/i18n/apply";

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
  // `getLocale()` is a non-reactive read. The hook re-runs whenever the
  // command menu's parent component re-renders (locale write triggers a
  // setting-drill pop, which always re-renders the menu) — so the fresh
  // locale flows in without a reload.
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
          // Hot-swap the locale: skip Paraglide's default full reload and
          // re-apply the locale-driven `<html dir|lang>` + font side-effects
          // ourselves. Paraglide's `m.*` message helpers re-evaluate per
          // render, so any tree that re-renders after the write picks up
          // the new translations without dropping the user's session.
          write: (next) => {
            // `setLocale` may be async if any custom strategy installs an
            // async setter — the registry returns `void`, so swallow the
            // promise. `applyLocaleStyling` only reads the post-write
            // locale via `getLocale()`, so DOM attributes stay correct
            // even when the underlying store update is async.
            void setLocale(next as Locale, { reload: false });
            applyLocaleStyling();
          },
        };
      }
      return setting;
    });
  }, [currentLocale, resolvedTheme, setTheme, theme]);
}
