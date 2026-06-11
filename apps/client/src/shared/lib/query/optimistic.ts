import type { QueryClient, QueryKey } from "@tanstack/react-query";

/**
 * Cancels in-flight queries for `key`, snapshots the current cache entry, and
 * optionally applies an optimistic update. Returns the snapshot so a mutation
 * can stash it as context and roll back on error.
 */
export async function snapshotQuery<T>(
  qc: QueryClient,
  key: QueryKey,
  update?: (cur: T | undefined) => T | undefined,
): Promise<{ prev: T | undefined }> {
  await qc.cancelQueries({ queryKey: key });
  const prev = qc.getQueryData<T>(key);
  if (update) qc.setQueryData<T>(key, (cur) => update(cur));
  return { prev };
}

/**
 * Restores a previously captured snapshot into the cache entry for `key`.
 * A `prev` of `undefined` is a no-op: passing it to `setQueryData` would
 * remove the cache entry rather than leave it untouched.
 */
export function rollbackQuery<T>(qc: QueryClient, key: QueryKey, prev: T | undefined): void {
  if (prev !== undefined) qc.setQueryData<T>(key, prev);
}
