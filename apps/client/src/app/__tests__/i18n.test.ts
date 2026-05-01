// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { DEFAULT_LOCALE, persistLocale, resolveInitialLocale, SUPPORTED_LOCALES } from "../i18n";

const STORAGE_KEY = "locale";

function setNavigatorLanguage(value: string | undefined) {
  Object.defineProperty(globalThis.navigator, "language", {
    value,
    configurable: true,
  });
}

describe("resolveInitialLocale", () => {
  beforeEach(() => {
    localStorage.clear();
    setNavigatorLanguage("en-US");
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("returns the stored locale when supported", () => {
    localStorage.setItem(STORAGE_KEY, "en");
    setNavigatorLanguage("fr-FR");
    expect(resolveInitialLocale()).toBe("en");
  });

  it("falls back to navigator language prefix match when storage empty", () => {
    setNavigatorLanguage("en-GB");
    expect(resolveInitialLocale()).toBe("en");
  });

  it("falls back to default when navigator language is unsupported", () => {
    setNavigatorLanguage("fr-FR");
    expect(resolveInitialLocale()).toBe(DEFAULT_LOCALE);
  });

  it("ignores stored locale that is not in the supported list", () => {
    localStorage.setItem(STORAGE_KEY, "zz");
    setNavigatorLanguage("en");
    expect(resolveInitialLocale()).toBe("en");
  });

  it("returns default when storage is empty and navigator language missing", () => {
    setNavigatorLanguage("");
    expect(resolveInitialLocale()).toBe(DEFAULT_LOCALE);
  });
});

describe("persistLocale", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("writes the locale to localStorage", () => {
    persistLocale("en");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("en");
  });

  it("ignores storage failures silently", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => persistLocale("en")).not.toThrow();
    setItem.mockRestore();
  });
});

describe("SUPPORTED_LOCALES", () => {
  it("includes the default locale", () => {
    expect((SUPPORTED_LOCALES as readonly string[]).includes(DEFAULT_LOCALE)).toBe(true);
  });
});
