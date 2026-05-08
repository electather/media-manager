import { describe, expect, it, vi } from "vite-plus/test";

import { buildCommandActions, nextTheme } from "../actions";
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

describe("buildCommandActions", () => {
  it("uses unique ids across all actions", () => {
    const actions = buildCommandActions({
      setTheme: vi.fn(),
      resolveTheme: () => "system",
    });
    const ids = actions.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("does not collide with page or search-mode ids", () => {
    const actionIds = buildCommandActions({
      setTheme: vi.fn(),
      resolveTheme: () => "system",
    }).map((a) => a.id);
    const allIds = [
      ...COMMAND_PAGES.map((p) => p.id),
      ...COMMAND_SEARCH_MODES.map((m) => m.id),
      ...actionIds,
    ];
    expect(new Set(allIds).size).toBe(allIds.length);
  });
});

describe("nextTheme", () => {
  it("cycles system → light → dark → system", () => {
    expect(nextTheme("system")).toBe("light");
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("system");
  });

  it("treats undefined as the start of the cycle and advances to light", () => {
    expect(nextTheme(undefined)).toBe("light");
  });

  it("falls back to system for unrecognised string values", () => {
    expect(nextTheme("midnight")).toBe("system");
  });
});
