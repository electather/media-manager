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

  it("rejects an array with the right prefix but a non-object at position 2", () => {
    expect(isSearchKey(["command-menu", "search", "not-an-object"])).toBe(false);
  });

  it("rejects null at position 2", () => {
    // Exercises the `value !== null` guard in hasKindParam.
    expect(isSearchKey(["command-menu", "search", null])).toBe(false);
  });

  it("rejects an object at position 2 that has no kind field", () => {
    // Exercises the `"kind" in value` branch in hasKindParam.
    expect(isSearchKey(["command-menu", "search", { q: "foo" }])).toBe(false);
  });

  it("rejects a key with a wrong root segment", () => {
    // Exercises the key[0] === "command-menu" guard.
    expect(isSearchKey(["other-feature", "search", { kind: "all" }])).toBe(false);
  });

  it("rejects an object at position 2 with a non-string kind field", () => {
    // Exercises the typeof kind === "string" guard in hasKindParam.
    expect(isSearchKey(["command-menu", "search", { kind: 42 }])).toBe(false);
  });
});
