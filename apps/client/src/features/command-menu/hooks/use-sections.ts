import type { CompactMediaItem } from "@ent-mcp/shared/home";
import { useMemo } from "react";

import type { CommandScope, MediaItem, NavFrame } from "../types";

const TRENDING_LIMIT = 8;
const RECENTS_LIMIT = 4;

type SectionsInput = {
  topFrame: NavFrame;
  value: string;
  recents: MediaItem[];
  /** Live `/api/discover/trending` results scoped to the active media tab. */
  trendingResults: CompactMediaItem[] | undefined;
  /** Live `/api/search` results — sourced from `useSearchResults`. */
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
 * and search query. Both media-bearing sections (trending + results) come
 * from server queries — there is no in-memory pool fallback any more.
 */
export function useSections({
  topFrame,
  value,
  recents,
  trendingResults,
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

  const trendingItems = useMemo<MediaItem[]>(() => {
    if (!showTrending || !trendingResults) return [];
    return trendingResults.slice(0, TRENDING_LIMIT);
  }, [showTrending, trendingResults]);

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
