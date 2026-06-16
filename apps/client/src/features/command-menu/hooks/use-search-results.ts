import { useQuery } from "@tanstack/react-query";
import type { SearchKind } from "@nama/shared/search";
import { isNil } from "es-toolkit/predicate";
import { trim } from "es-toolkit/string";
import { useDeferredValue } from "react";

import { fetchSearch, type SearchResult } from "../lib/fetchers";
import { commandMenuKeys } from "../lib/query-keys";
import { useDebouncedValue } from "../lib/use-debounced-value";
import type { CommandScope } from "../types";

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 200;
// Shorter than the 60s default: search results should track the live index
// closely, but cache long enough that retyping the same query within a session
// stays instant.
const STALE_MS = 30_000;

function scopeToKind(scope: CommandScope): SearchKind {
  return isNil(scope) ? "all" : scope;
}

export interface UseSearchResultsResult {
  data: SearchResult | undefined;
  /** True when the user typed enough to trigger a fetch. */
  isSearching: boolean;
  /** Initial fetch in flight — no `data` yet. */
  isPending: boolean;
  /** Any fetch in flight, including background refetches while placeholder data is shown. */
  isFetching: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Live `/api/search` results scoped to the current frame. The query is
 * `useDeferredValue`-wrapped so cmdk's input stays responsive while React
 * defers the fetch, then `useDebouncedValue` keeps the network off the path
 * for typeahead bursts. Falls back to no-op when the query is short.
 *
 * Placeholder data is only kept when the previous query shared the same scope
 * (kind). Carrying over results from a different scope would briefly present
 * the wrong titles under the new scope's heading before the fresh fetch lands.
 */
export function useSearchResults(rawQuery: string, scope: CommandScope): UseSearchResultsResult {
  const deferred = useDeferredValue(rawQuery);
  const debounced = useDebouncedValue(deferred, DEBOUNCE_MS);
  const trimmed = trim(debounced);
  const enabled = trimmed.length >= MIN_QUERY_LENGTH;
  const kind = scopeToKind(scope);

  const query = useQuery({
    queryKey: commandMenuKeys.search(trimmed, kind),
    queryFn: () => fetchSearch({ q: trimmed, kind }),
    enabled,
    staleTime: STALE_MS,
    // Only show stale results as a placeholder when the scope (kind) has not
    // changed — cross-scope placeholder data would label the wrong titles as
    // results for the new scope until the fresh fetch resolves.
    placeholderData: (previousData, previousQuery) => {
      if (!previousQuery) return undefined;
      // `commandMenuKeys.search` always returns a 3-tuple, so index [2] is
      // always defined — the cast and direct access are both safe here.
      const prevKey = previousQuery.queryKey as ReturnType<typeof commandMenuKeys.search>;
      const prevKind = prevKey[2].kind;
      return prevKind === kind ? previousData : undefined;
    },
  });

  return {
    data: enabled ? query.data : undefined,
    isSearching: enabled,
    isPending: enabled && query.isPending,
    isFetching: enabled && query.isFetching,
    isError: enabled && query.isError,
    error: enabled ? (query.error ?? null) : null,
    refetch: () => {
      void query.refetch();
    },
  };
}
