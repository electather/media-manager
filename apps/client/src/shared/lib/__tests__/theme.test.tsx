// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  THEME_STORAGE_KEY,
  ThemeProvider,
  applyThemePreference,
  resolveThemePreference,
  useTheme,
} from "../theme";

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

function ThemeProbe() {
  const { resolvedTheme, setTheme, theme } = useTheme();

  return (
    <div>
      <output aria-label="theme">{theme}</output>
      <output aria-label="resolved theme">{resolvedTheme}</output>
      <button type="button" onClick={() => setTheme("dark")}>
        Dark
      </button>
      <button type="button" onClick={() => setTheme("light")}>
        Light
      </button>
    </div>
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.style.colorScheme = "";
  setSystemDark(false);
});

afterEach(() => {
  cleanup();
});

describe("theme", () => {
  it("resolves the system preference from the media query", () => {
    expect(resolveThemePreference("system", true)).toBe("dark");
    expect(resolveThemePreference("system", false)).toBe("light");
    expect(resolveThemePreference("dark", false)).toBe("dark");
    expect(resolveThemePreference("light", true)).toBe("light");
  });

  it("applies light mode by removing the dark class before paint", () => {
    document.documentElement.classList.add("dark");

    applyThemePreference("light");

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("persists theme writes to localStorage and updates the document class", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Dark" }));

    await waitFor(() => expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark"));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(screen.getByLabelText("theme").textContent).toBe("dark");
    expect(screen.getByLabelText("resolved theme").textContent).toBe("dark");

    await user.click(screen.getByRole("button", { name: "Light" }));

    await waitFor(() => expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light"));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(screen.getByLabelText("theme").textContent).toBe("light");
    expect(screen.getByLabelText("resolved theme").textContent).toBe("light");
  });

  it("loads the stored theme before the React bundle", () => {
    const html = readFileSync("apps/client/index.html", "utf8");
    const bootScriptIndex = html.indexOf('src="/theme-init.js"');
    const appScriptIndex = html.indexOf("/src/main.tsx");

    expect(bootScriptIndex).toBeGreaterThan(-1);
    expect(appScriptIndex).toBeGreaterThan(-1);
    expect(bootScriptIndex).toBeLessThan(appScriptIndex);
    expect(html).not.toContain('<html lang="en" class="dark">');

    const bootScript = readFileSync("apps/client/public/theme-init.js", "utf8");
    expect(bootScript).toContain('const STORAGE_KEY = "theme";');
  });
});
