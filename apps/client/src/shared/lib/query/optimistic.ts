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
 * When `prev` is `undefined` the default behaviour is a no-op: passing it to
 * `setQueryData` would remove the cache entry rather than leave it untouched.
 * Pass `removeOnEmpty: true` to explicitly clean up a stale optimistic write
 * that was applied against an empty cache (i.e. when there was no prior entry
 * to restore).
 *
 * The cleanup uses `removeQueries` with `exact: true` so it only evicts the
 * exact key that was optimistically written. The restore path (`setQueryData`)
 * is already exact, and the keys passed here are prefixes of other keys in the
 * query-key factories (e.g. `inboxAll()` is a prefix of `popoverInbox(...)`);
 * a non-exact removal would tear down unrelated list/detail caches. We remove
 * the entry rather than `setQueryData(key, undefined)` because the goal is to
 * drop a cache entry that should never have existed, not to leave a live query
 * observing `undefined`.
 */
export function rollbackQuery<T>(
  qc: QueryClient,
  key: QueryKey,
  prev: T | undefined,
  { removeOnEmpty = false }: { removeOnEmpty?: boolean } = {},
): void {
  if (prev !== undefined) {
    qc.setQueryData<T>(key, prev);
  } else if (removeOnEmpty) {
    qc.removeQueries({ queryKey: key, exact: true });
  }
}
