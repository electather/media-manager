// Inline pre-hydration theme bootstrap. Runs before React mounts so the
// document already has the right `dark` class + `color-scheme` and the user
// never sees a light/dark flash.
//
// The storage key and resolution rules MUST stay aligned with
// `apps/client/src/shared/lib/theme.tsx` (THEME_STORAGE_KEY,
// resolveThemePreference). The runtime provider re-applies on mount, so any
// drift here surfaces as a one-frame FOUC.
(() => {
  const STORAGE_KEY = "theme";
  const DARK_QUERY = "(prefers-color-scheme: dark)";
  let preference = "system";

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "system" || stored === "light" || stored === "dark") {
      preference = stored;
    }
  } catch {
    /* Ignore storage access failures in restricted browser contexts. */
  }

  let systemPrefersDark = false;
  try {
    systemPrefersDark = window.matchMedia(DARK_QUERY).matches;
  } catch {
    /* Ignore media query failures and fall back to light mode. */
  }

  const resolved = preference === "system" ? (systemPrefersDark ? "dark" : "light") : preference;
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.style.colorScheme = resolved;
})();
