import { describe, expect, it } from "vite-plus/test";

import { COMMAND_ACTIONS } from "../actions";
import { COMMAND_PAGES } from "../pages";
import { COMMAND_SEARCH_MODES } from "../search-modes";
import { COMMAND_SETTINGS } from "../settings";

describe("COMMAND_PAGES", () => {
  it("uses unique ids", () => {
    const ids = COMMAND_PAGES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("opens with the home page first", () => {
    expect(COMMAND_PAGES[0]?.to).toBe("/");
  });

  it("declares a vim-style sequence per page", () => {
    for (const page of COMMAND_PAGES) {
      expect(page.sequence?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe("COMMAND_SEARCH_MODES", () => {
  it("offers exactly one TV and one Movie scope", () => {
    const scopes = COMMAND_SEARCH_MODES.map((m) => m.scope).sort();
    expect(scopes).toEqual(["movie", "tv"]);
  });
});

describe("COMMAND_ACTIONS", () => {
  it("uses unique ids", () => {
    const ids = COMMAND_ACTIONS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes the show-shortcuts action", () => {
    expect(COMMAND_ACTIONS.some((a) => a.id === "act:show-shortcuts")).toBe(true);
  });
});

describe("contribution id uniqueness", () => {
  it("does not collide across pages, search-modes, actions, or settings", () => {
    const allIds = [
      ...COMMAND_PAGES.map((p) => p.id),
      ...COMMAND_SEARCH_MODES.map((m) => m.id),
      ...COMMAND_ACTIONS.map((a) => a.id),
      ...COMMAND_SETTINGS.map((s) => s.id),
    ];
    expect(new Set(allIds).size).toBe(allIds.length);
  });
});
