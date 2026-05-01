import { getLocale } from "@/paraglide/runtime";
import { htmlDirFor } from "./rtl";
import { ensureLocaleFontLoaded } from "./fonts";

// Single entry point for locale-driven DOM mutations: <html dir>, <html lang>,
// and Google Fonts <link> injection for locale-specific font overrides.
export function applyLocaleStyling(): void {
  const locale = getLocale();
  document.documentElement.dir = htmlDirFor(locale);
  document.documentElement.lang = locale;
  ensureLocaleFontLoaded(locale);
}
