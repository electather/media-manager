import { useEffect } from "react";
import { getLocale } from "@/paraglide/runtime";
import { applyLocaleStyling } from "@/shared/lib/i18n/apply";
import { htmlDirFor } from "@/shared/lib/i18n/rtl";

// Single root hook owning locale-driven DOM (V64). Sets <html dir>, <html
// lang>, and triggers per-locale Google Fonts injection. Returns dir so
// callers (e.g. DirectionProvider) avoid recomputing it.
export function useHtmlDir(): "rtl" | "ltr" {
  // Empty dep array is intentional: setLocale() triggers a full page reload by
  // Paraglide default per SPEC I.i18n, so the effect runs on every locale
  // change via remount. Subscribe to a locale signal here if setLocale ever
  // becomes non-reloading.
  useEffect(() => {
    applyLocaleStyling();
  }, []);
  return htmlDirFor(getLocale());
}
