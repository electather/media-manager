import { describe, expect, it } from "vite-plus/test";

import { commandMenuKeys, isSearchKey } from "../query-keys";

describe("isSearchKey", () => {
  it("accepts a well-formed search key", () => {
    expect(isSearchKey(commandMenuKeys.search("x", "all"))).toBe(true);
  });

  it("rejects a trending key", () => {
    expect(isSearchKey(commandMenuKeys.trending("movie"))).toBe(false);
  });

  it("rejects the bare namespace key", () => {
    expect(isSearchKey(commandMenuKeys.all)).toBe(false);
  });

  it("rejects an empty array", () => {
    expect(isSearchKey([])).toBe(false);
  });

  it("rejects a key with the wrong root segment", () => {
    expect(isSearchKey(["other", "search", { kind: "all" }])).toBe(false);
  });

  it("rejects a search-looking key whose params object lacks kind", () => {
    expect(isSearchKey(["command-menu", "search", { q: "x" }])).toBe(false);
  });
});
