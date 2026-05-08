import type { CompactMediaItem } from "@ent-mcp/shared/home";
import { useMemo } from "react";

import type { CommandScope, MediaItem, NavFrame } from "../types";

const TRENDING_LIMIT = 8;
const RECENTS_LIMIT = 4;

type SectionsInput = {
  topFrame: NavFrame;
  value: string;
  recents: MediaItem[];
  pool: MediaItem[];
  trending: MediaItem[];
  /** Live `/api/search` results — replaces in-memory fuzzy match against `pool`. */
  searchResults: CompactMediaItem[] | undefined;
};

export type Sections = {
  scope: CommandScope;
  showSearchModes: boolean;
  showPages: boolean;
  showActions: boolean;
  showSettings: boolean;
  recentItems: MediaItem[];
  trendingItems: MediaItem[];
  mediaItems: MediaItem[];
};

/**
 * Derives which command-menu groups render based on the current top frame
 * and search query. `mediaItems` is now sourced from the live search query —
 * `pool` is consumed only for recents lookups and the trending fallback.
 */
export function useSections({
  topFrame,
  value,
  recents,
  pool,
  trending,
  searchResults,
}: SectionsInput): Sections {
  const isRoot = topFrame.kind === "root";
  const scope: CommandScope = topFrame.kind === "scope" ? topFrame.scope : null;

  const showSearchModes = isRoot && !value;
  const showPages = isRoot;
  const showActions = isRoot;
  const showSettings = isRoot;
  const showTrending = scope !== null && !value;

  const recentItems = useMemo(() => {
    if (!isRoot || value) return [] as MediaItem[];
    return recents.slice(0, RECENTS_LIMIT);
  }, [isRoot, recents, value]);

  const trendingItems = useMemo(() => {
    if (!showTrending || !scope) return [] as MediaItem[];
    const seen = new Set<string>();
    const out: MediaItem[] = [];
    const push = (item: MediaItem) => {
      if (item.mediaType !== scope || seen.has(item.id)) return;
      seen.add(item.id);
      out.push(item);
    };
    trending.forEach(push);
    if (out.length < TRENDING_LIMIT) pool.forEach(push);
    return out.slice(0, TRENDING_LIMIT);
  }, [pool, scope, showTrending, trending]);

  const mediaItems = useMemo<MediaItem[]>(() => {
    if (showTrending) return [];
    if (!searchResults) return [];
    return searchResults;
  }, [searchResults, showTrending]);

  return {
    scope,
    showSearchModes,
    showPages,
    showActions,
    showSettings,
    recentItems,
    trendingItems,
    mediaItems,
  };
}
