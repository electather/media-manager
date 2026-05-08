import { useCallback, useEffect, useState } from "react";

import type { MediaItem } from "../types";

const STORAGE_KEY = "media-manager:command-menu:recents";
const MAX_RECENTS = 5;

function isMediaItem(value: unknown): value is MediaItem {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.title === "string" &&
    (v.mediaType === "tv" || v.mediaType === "movie")
  );
}

function safeParseRecents(raw: string | null): MediaItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isMediaItem);
  } catch {
    return [];
  }
}

function readStorage(): MediaItem[] {
  if (typeof window === "undefined") return [];
  return safeParseRecents(window.localStorage.getItem(STORAGE_KEY));
}

function writeStorage(items: MediaItem[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Ignore quota / privacy mode failures.
  }
}

export function useRecentItems(): {
  recents: MediaItem[];
  pushRecent: (item: MediaItem) => void;
} {
  const [recents, setRecents] = useState<MediaItem[]>([]);

  // TODO(cross-tab-sync): listen on `window.addEventListener("storage", ...)`
  // so a recent added in another tab shows up here without requiring a reload.
  useEffect(() => {
    setRecents(readStorage().slice(0, MAX_RECENTS));
  }, []);

  const pushRecent = useCallback((item: MediaItem) => {
    setRecents((prev) => {
      const next = [item, ...prev.filter((existing) => existing.id !== item.id)].slice(
        0,
        MAX_RECENTS,
      );
      writeStorage(next);
      return next;
    });
  }, []);

  return { recents, pushRecent };
}
