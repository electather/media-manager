import { Languages } from "lucide-react";

import { locales } from "@/paraglide/runtime";

import type { SettingItem, SettingOption, StaticMessageKey } from "../../types";

type Locale = (typeof locales)[number];

const LOCALE_LABEL_KEYS = {
  en: "locale_en_label",
  fa: "locale_fa_label",
} satisfies Record<Locale, StaticMessageKey>;

// `useBoundSettings()` binds write to setLocale(next, {reload:false}) for in-place swap. Bind site re-applies dir/lang/font via applyLocaleStyling().
export const LOCALE_SETTING: SettingItem<string> = {
  kind: "setting",
  id: "setting:locale",
  Icon: Languages,
  labelKey: "command_menu_setting_locale_label",
  hintKey: "command_menu_setting_locale_hint",
  toastKey: "command_menu_setting_locale_toast",
  options: locales.map(
    (l): SettingOption<string> => ({
      id: l,
      labelKey: LOCALE_LABEL_KEYS[l as Locale],
    }),
  ),
  read: () => "en",
  write: () => {},
};
