// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { useRecentItems } from "../use-recent-items";

const STORAGE_KEY = "media-manager:command-menu:recents";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

beforeEach(() => {
  window.localStorage.clear();
});

describe("useRecentItems", () => {
  it("starts empty when no storage", () => {
    const { result } = renderHook(() => useRecentItems());
    expect(result.current.recents).toEqual([]);
  });

  it("loads existing recents from localStorage", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(["movie:a", "tv:b"]));
    const { result } = renderHook(() => useRecentItems());
    expect(result.current.recents).toEqual(["movie:a", "tv:b"]);
  });

  it("pushes new ids to the front, drops duplicates", () => {
    const { result } = renderHook(() => useRecentItems());
    act(() => result.current.pushRecent("movie:a"));
    act(() => result.current.pushRecent("tv:b"));
    act(() => result.current.pushRecent("movie:a"));
    expect(result.current.recents).toEqual(["movie:a", "tv:b"]);
  });

  it("caps the recent list to five entries", () => {
    const { result } = renderHook(() => useRecentItems());
    for (const id of ["a", "b", "c", "d", "e", "f"]) {
      act(() => result.current.pushRecent(id));
    }
    expect(result.current.recents).toEqual(["f", "e", "d", "c", "b"]);
  });

  it("ignores corrupted storage values", () => {
    window.localStorage.setItem(STORAGE_KEY, "not-json");
    const { result } = renderHook(() => useRecentItems());
    expect(result.current.recents).toEqual([]);
  });
});
