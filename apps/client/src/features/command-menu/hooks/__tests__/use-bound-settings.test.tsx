// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { THEME_STORAGE_KEY, ThemeProvider } from "@/shared/lib/theme";

import { useBoundSettings } from "../use-bound-settings";

function setSystemDark(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query === "(prefers-color-scheme: dark)" ? matches : false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

function wrapper({ children }: { children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
  setSystemDark(false);
});

afterEach(() => {
  cleanup();
});

describe("useBoundSettings", () => {
  it("binds the theme setting to the app theme provider", async () => {
    const { result } = renderHook(() => useBoundSettings(), { wrapper });
    const getThemeSetting = () => result.current.find((setting) => setting.id === "setting:theme");

    expect(getThemeSetting()).toBeDefined();

    act(() => getThemeSetting()?.write("dark"));

    await waitFor(() => expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark"));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(getThemeSetting()?.read()).toBe("dark");

    act(() => getThemeSetting()?.write("light"));

    await waitFor(() => expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light"));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
