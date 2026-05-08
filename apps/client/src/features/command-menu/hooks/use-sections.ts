import { useMemo } from "react";

import type { CommandScope, MediaItem, NavFrame } from "../types";

const TRENDING_LIMIT = 8;
const RECENTS_LIMIT = 4;

type SectionsInput = {
  topFrame: NavFrame;
  value: string;
  recents: string[];
  pool: MediaItem[];
  trending: MediaItem[];
};

export type Sections = {
  scope: CommandScope;
  showSearchModes: boolean;
  showPages: boolean;
  showActions: boolean;
  recentItems: MediaItem[];
  trendingItems: MediaItem[];
  mediaItems: MediaItem[];
};

/**
 * Derives which command-menu groups render based on the current top frame
 * and search query. Pure of side effects — exposed as a hook only so the
 * memoization cache stays attached to the menu component instance.
 */
export function useSections({ topFrame, value, recents, pool, trending }: SectionsInput): Sections {
  const isRoot = topFrame.kind === "root";
  const scope: CommandScope = topFrame.kind === "scope" ? topFrame.scope : null;

  const showSearchModes = isRoot && !value;
  const showPages = isRoot;
  const showActions = isRoot;
  const showTrending = scope !== null && !value;

  const recentItems = useMemo(() => {
    if (!isRoot || value) return [] as MediaItem[];
    return recents
      .map((id) => pool.find((item) => item.id === id))
      .filter((x): x is MediaItem => x != null)
      .slice(0, RECENTS_LIMIT);
  }, [isRoot, pool, recents, value]);

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

  const mediaItems = useMemo(() => {
    if (showTrending) return [] as MediaItem[];
    // §10: at the empty root we want search-modes/recents/pages/actions/
    // settings only — no bulk pool dump beneath them. The pool is exposed
    // only after the user has typed (cmdk filters via match-values).
    if (!scope && isRoot) return value ? pool : ([] as MediaItem[]);
    return scope ? pool.filter((item) => item.mediaType === scope) : [];
  }, [isRoot, pool, scope, showTrending, value]);

  return { scope, showSearchModes, showPages, showActions, recentItems, trendingItems, mediaItems };
}
