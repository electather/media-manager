// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import type { MediaItem } from "../../types";
import { useRecentItems } from "../use-recent-items";

const LEGACY_STORAGE_KEY = "nama:command-menu:recents";
const STORAGE_KEY = "nama:command-menu:recents:v1";

function makeItem(id: string, mediaType: "tv" | "movie" = "movie"): MediaItem {
  return { id, tmdbId: id.split(":")[1] ?? id, mediaType, title: `Title ${id}` };
}

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

  it("loads existing snapshots from localStorage", () => {
    const stored = [makeItem("movie:a"), makeItem("tv:b", "tv")];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    const { result } = renderHook(() => useRecentItems());
    expect(result.current.recents.map((r) => r.id)).toEqual(["movie:a", "tv:b"]);
  });

  it("ignores legacy snapshots", () => {
    const stored = [makeItem("movie:a"), makeItem("tv:b", "tv")];
    window.localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(stored));
    const { result } = renderHook(() => useRecentItems());
    expect(result.current.recents).toEqual([]);
    expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBe(JSON.stringify(stored));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("pushes new items to the front, drops duplicates by id", () => {
    const { result } = renderHook(() => useRecentItems());
    const a = makeItem("movie:a");
    const b = makeItem("tv:b", "tv");
    act(() => result.current.pushRecent(a));
    act(() => result.current.pushRecent(b));
    act(() => result.current.pushRecent(a));
    expect(result.current.recents.map((r) => r.id)).toEqual(["movie:a", "tv:b"]);
  });

  it("caps the recent list to five entries", () => {
    const { result } = renderHook(() => useRecentItems());
    for (const id of ["a", "b", "c", "d", "e", "f"]) {
      act(() => result.current.pushRecent(makeItem(id)));
    }
    expect(result.current.recents.map((r) => r.id)).toEqual(["f", "e", "d", "c", "b"]);
  });

  it("persists a minimal versioned snapshot", () => {
    const { result } = renderHook(() => useRecentItems());
    act(() =>
      result.current.pushRecent({
        ...makeItem("movie:a"),
        backdrop: "https://example.test/backdrop.jpg",
        cast: ["Actor"],
        director: "Director",
        poster: "https://example.test/poster.jpg",
        runtime: "120 min",
        tags: ["tag"],
        year: 2026,
      }),
    );
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]")).toEqual([
      {
        id: "movie:a",
        tmdbId: "a",
        mediaType: "movie",
        title: "Title movie:a",
        backdrop: "https://example.test/backdrop.jpg",
        poster: "https://example.test/poster.jpg",
        runtime: "120 min",
        year: 2026,
      },
    ]);
  });

  it("ignores corrupted storage values", () => {
    window.localStorage.setItem(STORAGE_KEY, "not-json");
    const { result } = renderHook(() => useRecentItems());
    expect(result.current.recents).toEqual([]);
  });

  it("drops entries that don't match the snapshot shape", () => {
    // Pre-stable migration — old format stored bare ids, ignore them.
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(["movie:a", { not: "an item" }]));
    const { result } = renderHook(() => useRecentItems());
    expect(result.current.recents).toEqual([]);
  });
});
