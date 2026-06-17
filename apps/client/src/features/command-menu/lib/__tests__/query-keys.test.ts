import { describe, expect, it } from "vite-plus/test";

import { commandMenuKeys, isSearchKey } from "../query-keys";

describe("isSearchKey", () => {
  it("returns false for a key missing q", () => {
    expect(isSearchKey(["command-menu", "search", { kind: "all" }])).toBe(false);
  });

  it("returns false for a key missing kind", () => {
    expect(isSearchKey(["command-menu", "search", { q: "blade" }])).toBe(false);
  });

  it("returns false for a non-search key", () => {
    expect(isSearchKey(commandMenuKeys.all)).toBe(false);
  });

  it("returns false for a trending key", () => {
    expect(isSearchKey(commandMenuKeys.trending("movie"))).toBe(false);
  });

  it("returns true for a valid search key produced by commandMenuKeys.search", () => {
    expect(isSearchKey(commandMenuKeys.search("blade", "all"))).toBe(true);
  });
});
