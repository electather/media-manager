// Per-locale font config. Dynamically inject Google Fonts <link> when locale
// matches; CSS rule in globals.css picks up the family via html[lang="<code>"].
// Add a locale-specific font: append entry here + matching CSS rule in
// `globals.css`.

export interface LocaleFont {
  family: string;
  cssUrl: string;
}

export const LOCALE_FONTS = {
  fa: {
    family: "Rubik",
    cssUrl: "https://fonts.googleapis.com/css2?family=Rubik:wght@300..900&display=swap",
  },
} satisfies Partial<Record<string, LocaleFont>>;

export function getLocaleFont(locale: string): LocaleFont | null {
  return LOCALE_FONTS[locale as keyof typeof LOCALE_FONTS] ?? null;
}

const LINK_ID_PREFIX = "locale-font-";
const PRECONNECT_GOOGLE_ID = "locale-font-preconnect-google";
const PRECONNECT_GSTATIC_ID = "locale-font-preconnect-gstatic";

function ensurePreconnects(): void {
  if (!document.getElementById(PRECONNECT_GOOGLE_ID)) {
    const link = document.createElement("link");
    link.id = PRECONNECT_GOOGLE_ID;
    link.rel = "preconnect";
    link.href = "https://fonts.googleapis.com";
    document.head.appendChild(link);
  }
  if (!document.getElementById(PRECONNECT_GSTATIC_ID)) {
    const link = document.createElement("link");
    link.id = PRECONNECT_GSTATIC_ID;
    link.rel = "preconnect";
    link.href = "https://fonts.gstatic.com";
    link.crossOrigin = "";
    document.head.appendChild(link);
  }
}

export function ensureLocaleFontLoaded(locale: string): void {
  const cfg = getLocaleFont(locale);
  if (!cfg) return;
  const id = `${LINK_ID_PREFIX}${locale}`;
  if (document.getElementById(id)) return;
  ensurePreconnects();
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = cfg.cssUrl;
  document.head.appendChild(link);
}
