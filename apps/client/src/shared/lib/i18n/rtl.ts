export const RTL_LOCALES = ["fa"] as const;

export function isRtlLocale(locale: string): boolean {
  return (RTL_LOCALES as readonly string[]).includes(locale);
}

export function htmlDirFor(locale: string): "rtl" | "ltr" {
  return isRtlLocale(locale) ? "rtl" : "ltr";
}
