import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import useLocalStorageState from "use-local-storage-state";
import { isString } from "es-toolkit/predicate";

// Pre-hydration bootstrap in `public/theme-init.js` (referenced by
// `index.html`) duplicates the storage key + resolve rule so the very first
// paint avoids a flash of the wrong palette. Update both sides in lockstep.
export const THEME_STORAGE_KEY = "theme";
export const THEME_PREFERENCES = ["system", "light", "dark"] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = Exclude<ThemePreference, "system">;

interface ThemeContextValue {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
}

const DARK_MODE_QUERY = "(prefers-color-scheme: dark)";

const ThemeContext = createContext<ThemeContextValue | null>(null);

const themeStorageSerializer = {
  stringify: (value: unknown) => (isThemePreference(value) ? value : "system"),
  parse: (value: string) => (isThemePreference(value) ? value : "system"),
};

function isThemePreference(value: unknown): value is ThemePreference {
  return isString(value) && THEME_PREFERENCES.includes(value as ThemePreference);
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  if (typeof window.matchMedia !== "function") return "light";
  return window.matchMedia(DARK_MODE_QUERY).matches ? "dark" : "light";
}

export function resolveThemePreference(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

export function applyThemePreference(preference: ThemePreference) {
  const resolvedTheme = resolveThemePreference(preference, getSystemTheme() === "dark");
  applyResolvedTheme(resolvedTheme);
}

function applyResolvedTheme(resolvedTheme: ResolvedTheme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
  document.documentElement.style.colorScheme = resolvedTheme;
}

function useSystemTheme() {
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;

    const media = window.matchMedia(DARK_MODE_QUERY);
    const updateSystemTheme = () => setSystemTheme(media.matches ? "dark" : "light");

    updateSystemTheme();
    media.addEventListener("change", updateSystemTheme);
    return () => media.removeEventListener("change", updateSystemTheme);
  }, []);

  return systemTheme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useLocalStorageState<ThemePreference>(THEME_STORAGE_KEY, {
    defaultValue: "system",
    defaultServerValue: "system",
    serializer: themeStorageSerializer,
  });
  const systemTheme = useSystemTheme();
  const resolvedTheme = resolveThemePreference(theme, systemTheme === "dark");

  useLayoutEffect(() => {
    applyResolvedTheme(resolvedTheme);
  }, [resolvedTheme]);

  const value = useMemo(
    () => ({
      theme,
      resolvedTheme,
      setTheme,
    }),
    [resolvedTheme, setTheme, theme],
  );

  return <ThemeContext value={value}>{children}</ThemeContext>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
