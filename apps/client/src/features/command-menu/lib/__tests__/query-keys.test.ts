import { describe, expect, it } from "vite-plus/test";

import { commandMenuKeys, isSearchKey } from "../query-keys";

describe("isSearchKey", () => {
  it("accepts a well-formed search key", () => {
    expect(isSearchKey(commandMenuKeys.search("x", "all"))).toBe(true);
  });

  it("rejects a trending key", () => {
    expect(isSearchKey(commandMenuKeys.trending("movie"))).toBe(false);
  });

  it("rejects the bare root key", () => {
    expect(isSearchKey(commandMenuKeys.all)).toBe(false);
  });

  it("rejects an empty array", () => {
    expect(isSearchKey([])).toBe(false);
  });

  it("rejects an array with the right prefix but no kind param", () => {
    expect(isSearchKey(["command-menu", "search", "not-an-object"])).toBe(false);
  });
});
