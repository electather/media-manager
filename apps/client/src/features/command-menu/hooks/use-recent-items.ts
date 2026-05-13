import { take } from "es-toolkit/array";
import { isPlainObject, isString } from "es-toolkit/predicate";
import { useCallback, useEffect, useState } from "react";

import type { MediaItem } from "../types";

const STORAGE_KEY = "media-manager:command-menu:recents:v1";
const MAX_RECENTS = 5;

// fallow-ignore-next-line complexity
function isMediaItem(value: unknown): value is MediaItem {
  if (!isPlainObject(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    isString(v.id) &&
    isString(v.tmdbId) &&
    isString(v.title) &&
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

function readStorageValue(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

// fallow-ignore-next-line complexity
function snapshotRecent(item: MediaItem): MediaItem {
  return {
    id: item.id,
    tmdbId: item.tmdbId,
    mediaType: item.mediaType,
    title: item.title,
    ...(item.year ? { year: item.year } : {}),
    ...(item.genres ? { genres: item.genres } : {}),
    ...(item.runtime ? { runtime: item.runtime } : {}),
    ...(item.poster ? { poster: item.poster } : {}),
    ...(item.backdrop ? { backdrop: item.backdrop } : {}),
  };
}

function readStorage(): MediaItem[] {
  return take(safeParseRecents(readStorageValue(STORAGE_KEY)), MAX_RECENTS);
}

function writeStorage(items: MediaItem[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.map(snapshotRecent)));
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
    setRecents(readStorage());
  }, []);

  const pushRecent = useCallback((item: MediaItem) => {
    setRecents((prev) => {
      const next = take(
        [snapshotRecent(item), ...prev.filter((existing) => existing.id !== item.id)],
        MAX_RECENTS,
      );
      writeStorage(next);
      return next;
    });
  }, []);

  return { recents, pushRecent };
}
