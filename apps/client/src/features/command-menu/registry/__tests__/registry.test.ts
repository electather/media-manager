import { describe, expect, it } from "vite-plus/test";

import { nextTheme } from "../actions";
import { COMMAND_PAGES } from "../pages";
import { COMMAND_SEARCH_MODES } from "../search-modes";

describe("COMMAND_PAGES", () => {
  it("uses unique ids", () => {
    const ids = COMMAND_PAGES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("opens with the home page first", () => {
    expect(COMMAND_PAGES[0]?.to).toBe("/");
  });
});

describe("COMMAND_SEARCH_MODES", () => {
  it("offers exactly one TV and one Movie scope", () => {
    const scopes = COMMAND_SEARCH_MODES.map((m) => m.scope).sort();
    expect(scopes).toEqual(["movie", "tv"]);
  });
});

describe("nextTheme", () => {
  it("cycles system → light → dark → system", () => {
    expect(nextTheme("system")).toBe("light");
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("system");
  });

  it("falls back to system for unknown values", () => {
    expect(nextTheme(undefined)).toBe("light");
    expect(nextTheme("midnight")).toBe("system");
  });
});
