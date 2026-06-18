import { describe, expect, it } from "vite-plus/test";

import { commandMenuKeys, isSearchKey } from "../query-keys";

describe("isSearchKey", () => {
  it("returns true for a valid search key produced by commandMenuKeys.search", () => {
    expect(isSearchKey(commandMenuKeys.search("blade", "all"))).toBe(true);
  });

  it("returns true for a search key with an empty query string", () => {
    expect(isSearchKey(commandMenuKeys.search("", "all"))).toBe(true);
  });

  it("returns false for a trending key", () => {
    expect(isSearchKey(commandMenuKeys.trending("movie"))).toBe(false);
  });

  it("returns false for a key with wrong verb but valid params", () => {
    expect(isSearchKey(["command-menu", "trending", { q: "x", kind: "all" }])).toBe(false);
  });

  it("returns false for a non-search key", () => {
    expect(isSearchKey(commandMenuKeys.all)).toBe(false);
  });

  it("returns false for an empty array", () => {
    expect(isSearchKey([])).toBe(false);
  });

  it("returns false for a key with the wrong root segment", () => {
    expect(isSearchKey(["other", "search", { q: "x", kind: "all" }])).toBe(false);
  });

  it("returns false for a key missing q", () => {
    expect(isSearchKey(["command-menu", "search", { kind: "all" }])).toBe(false);
  });

  it("returns false for a key missing kind", () => {
    expect(isSearchKey(["command-menu", "search", { q: "blade" }])).toBe(false);
  });

  it("returns false for a key with no params object", () => {
    expect(isSearchKey(["command-menu", "search"])).toBe(false);
  });

  it("returns false for a key with null at position 2", () => {
    expect(isSearchKey(["command-menu", "search", null])).toBe(false);
  });

  it("returns false for a key with undefined at position 2", () => {
    expect(isSearchKey(["command-menu", "search", undefined])).toBe(false);
  });
});
