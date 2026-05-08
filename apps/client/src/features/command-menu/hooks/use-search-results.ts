import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { SearchKind } from "@ent-mcp/shared/search";
import { useDeferredValue } from "react";

import { fetchSearch, type SearchResult } from "../lib/fetchers";
import { commandMenuKeys } from "../lib/query-keys";
import { useDebouncedValue } from "../lib/use-debounced-value";
import type { CommandScope } from "../types";

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 200;
const STALE_MS = 30_000;

function scopeToKind(scope: CommandScope): SearchKind {
  return scope === null ? "all" : scope;
}

export interface UseSearchResultsResult {
  data: SearchResult | undefined;
  /** True when the user typed enough to trigger a fetch. */
  isSearching: boolean;
  isPending: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Live `/api/search` results scoped to the current frame. The query is
 * `useDeferredValue`-wrapped so cmdk's input stays responsive while React
 * defers the fetch, then `useDebouncedValue` keeps the network off the path
 * for typeahead bursts. Falls back to no-op when the query is short.
 */
export function useSearchResults(rawQuery: string, scope: CommandScope): UseSearchResultsResult {
  const deferred = useDeferredValue(rawQuery);
  const debounced = useDebouncedValue(deferred, DEBOUNCE_MS);
  const trimmed = debounced.trim();
  const enabled = trimmed.length >= MIN_QUERY_LENGTH;
  const kind = scopeToKind(scope);

  const query = useQuery({
    queryKey: commandMenuKeys.search(trimmed, kind),
    queryFn: () => fetchSearch({ q: trimmed, kind }),
    enabled,
    staleTime: STALE_MS,
    placeholderData: keepPreviousData,
  });

  return {
    data: enabled ? query.data : undefined,
    isSearching: enabled,
    isPending: enabled && query.isPending,
    isError: enabled && query.isError,
    error: enabled ? (query.error ?? null) : null,
    refetch: () => {
      void query.refetch();
    },
  };
}
