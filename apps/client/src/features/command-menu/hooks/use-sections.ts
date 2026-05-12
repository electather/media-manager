import type { CompactMediaItem } from "@ent-mcp/shared/home";
import { useMemo } from "react";

import type { CommandScope, MediaItem, NavFrame } from "../types";
import { isNil } from "es-toolkit/predicate";

const TRENDING_LIMIT = 12;
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

/**
 * Which source backed the current `mediaItems`. Lets the host pick the right
 * heading ("Trending tv shows" vs "Results") and avoids two nearly-identical
 * `<CommandGroup>`s for the same media list.
 */
export type MediaSection = "results" | "trending" | null;

export type Sections = {
  scope: CommandScope;
  showSearchModes: boolean;
  showPages: boolean;
  showActions: boolean;
  showSettings: boolean;
  recentItems: MediaItem[];
  mediaItems: MediaItem[];
  mediaSection: MediaSection;
};

/**
 * Derives which command-menu groups render based on the current top frame
 * and search query. On scope frames, search results take over once the
 * server returns at least one match — until then trending stands in as a
 * placeholder, including while the search fetch is in flight.
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

  const recentItems = useMemo(() => {
    if (!isRoot || value) return [] as MediaItem[];
    return recents.slice(0, RECENTS_LIMIT);
  }, [isRoot, recents, value]);

  const trendingPool = useMemo<MediaItem[]>(() => {
    if (isNil(scope) || !trendingResults) return [];
    return trendingResults.slice(0, TRENDING_LIMIT);
  }, [scope, trendingResults]);

  const { mediaItems, mediaSection } = useMemo<{
    mediaItems: MediaItem[];
    mediaSection: MediaSection;
  }>(() => {
    if (isNil(scope)) {
      return { mediaItems: [], mediaSection: null };
    }
    // Once the server has answered the current query, honour that answer —
    // even when it's empty. Falling back to trending on a deliberate
    // no-match query would mislabel the row as "Trending" when the user is
    // actually looking at "no results" for what they typed.
    if (searchResults !== undefined) {
      return searchResults.length > 0
        ? { mediaItems: searchResults, mediaSection: "results" }
        : { mediaItems: [], mediaSection: null };
    }
    if (trendingPool.length > 0) {
      return { mediaItems: trendingPool, mediaSection: "trending" };
    }
    return { mediaItems: [], mediaSection: null };
  }, [scope, searchResults, trendingPool]);

  return {
    scope,
    showSearchModes,
    showPages,
    showActions,
    showSettings,
    recentItems,
    mediaItems,
    mediaSection,
  };
}
