import { i18n } from "@lingui/core";

export const SUPPORTED_LOCALES = ["en"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = "en";

const STORAGE_KEY = "locale";

function isSupported(value: string | null | undefined): value is SupportedLocale {
  return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

function readStoredLocale(): SupportedLocale | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isSupported(raw) ? raw : null;
  } catch {
    return null;
  }
}

function readNavigatorLocale(): SupportedLocale | null {
  if (typeof navigator === "undefined") return null;
  const lang = navigator.language;
  if (!lang) return null;
  if (isSupported(lang)) return lang;
  const prefix = lang.split("-")[0];
  return isSupported(prefix) ? prefix : null;
}

export function resolveInitialLocale(): SupportedLocale {
  return readStoredLocale() ?? readNavigatorLocale() ?? DEFAULT_LOCALE;
}

export function persistLocale(locale: SupportedLocale): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Storage unavailable (e.g. quota, privacy mode); silently ignore.
  }
}

export async function activateLocale(locale: SupportedLocale): Promise<void> {
  const { messages } = await import(`../locales/${locale}/messages.po`);
  i18n.load(locale, messages);
  i18n.activate(locale);
}

export { i18n };
