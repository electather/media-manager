import { take } from "es-toolkit/array";
import { omitBy } from "es-toolkit/object";
import { isNil, isPlainObject, isString } from "es-toolkit/predicate";
import { useCallback, useEffect, useState } from "react";

import type { MediaItem } from "../types";

const STORAGE_KEY = "nama:command-menu:recents:v1";
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

function snapshotRecent(item: MediaItem): MediaItem {
  return omitBy(
    {
      id: item.id,
      tmdbId: item.tmdbId,
      mediaType: item.mediaType,
      title: item.title,
      year: item.year,
      genres: item.genres,
      poster: item.poster,
      backdrop: item.backdrop,
    },
    isNil,
  ) as MediaItem;
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

  useEffect(() => {
    // Load persisted recents on mount.
    setRecents(readStorage());

    // Sync with other tabs: the `storage` event fires in every tab except the
    // one that wrote the value, so recents added elsewhere become visible
    // immediately without requiring a reload.
    function onStorage(event: StorageEvent): void {
      if (event.key === STORAGE_KEY) {
        setRecents(readStorage());
      }
    }

    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
    };
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
