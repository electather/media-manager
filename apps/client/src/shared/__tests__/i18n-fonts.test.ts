// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vite-plus/test";

import { LOCALE_FONTS, ensureLocaleFontLoaded, getLocaleFont } from "../lib/i18n/fonts";

afterEach(() => {
  for (const link of document.head.querySelectorAll("link")) {
    if (link.id.startsWith("locale-font-")) link.remove();
  }
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
});

describe("LOCALE_FONTS", () => {
  it("maps fa to Rubik via a Google Fonts variable URL", () => {
    expect(LOCALE_FONTS.fa.family).toBe("Rubik");
    expect(LOCALE_FONTS.fa.cssUrl).toContain("fonts.googleapis.com");
    expect(LOCALE_FONTS.fa.cssUrl).toContain("Rubik");
  });

  it("getLocaleFont returns null for locales without a custom font", () => {
    expect(getLocaleFont("en")).toBeNull();
    expect(getLocaleFont("de")).toBeNull();
  });
});

describe("ensureLocaleFontLoaded", () => {
  it("injects a <link rel=stylesheet> for matching locales", () => {
    ensureLocaleFontLoaded("fa");
    const link = document.getElementById("locale-font-fa") as HTMLLinkElement | null;
    expect(link).not.toBeNull();
    expect(link?.rel).toBe("stylesheet");
    expect(link?.href).toContain("Rubik");
  });

  it("is idempotent — repeated calls do not stack <link> tags", () => {
    ensureLocaleFontLoaded("fa");
    ensureLocaleFontLoaded("fa");
    ensureLocaleFontLoaded("fa");
    expect(document.querySelectorAll("#locale-font-fa")).toHaveLength(1);
  });

  it("is a no-op for locales without a configured font", () => {
    ensureLocaleFontLoaded("en");
    expect(document.querySelectorAll('link[id^="locale-font-"]')).toHaveLength(0);
  });

  it("attaches preconnect hints once", () => {
    ensureLocaleFontLoaded("fa");
    ensureLocaleFontLoaded("fa");
    expect(document.querySelectorAll("#locale-font-preconnect-google")).toHaveLength(1);
    expect(document.querySelectorAll("#locale-font-preconnect-gstatic")).toHaveLength(1);
  });
});
