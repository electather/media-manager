import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "media-manager:command-menu:recents";
const MAX_RECENTS = 5;

function safeParseRecents(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

function readStorage(): string[] {
  if (typeof window === "undefined") return [];
  return safeParseRecents(window.localStorage.getItem(STORAGE_KEY));
}

function writeStorage(ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // ignore quota / privacy mode failures
  }
}

export function useRecentItems(): { recents: string[]; pushRecent: (id: string) => void } {
  const [recents, setRecents] = useState<string[]>([]);

  // TODO(cross-tab-sync): listen on `window.addEventListener("storage", ...)`
  // so a recent added in another tab shows up here without requiring a reload.
  useEffect(() => {
    setRecents(readStorage().slice(0, MAX_RECENTS));
  }, []);

  const pushRecent = useCallback((id: string) => {
    setRecents((prev) => {
      const next = [id, ...prev.filter((existing) => existing !== id)].slice(0, MAX_RECENTS);
      writeStorage(next);
      return next;
    });
  }, []);

  return { recents, pushRecent };
}
