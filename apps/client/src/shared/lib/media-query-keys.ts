/**
 * Shared media query-keys factory.
 *
 * Both home rails and watchlist lists share the same key skeleton —
 * `[namespace, "list", opts]` for paginated lists, `[namespace, "row", id, cursor]`
 * for per-row infinite scrolls — so a single factory yields the parent
 * keys each feature composes on top of. Per-feature extras (watchlist
 * counts, home layout/details) sit alongside the factory output via
 * spread inside the feature's own `query-keys.ts`.
 *
 * The namespace is the very root of the key — invalidating it sweeps
 * every cache under that feature (lists + counts + rows + …) in one call.
 */
export function createMediaQueryKeys<NS extends string>(namespace: NS) {
  const all = [namespace] as const;
  const listsKey = () => [...all, "list"] as const;
  const rowsKey = () => [...all, "row"] as const;
  return {
    all,
    lists: listsKey,
    list: <Opts>(opts: Opts) => [...listsKey(), opts] as const,
    rows: rowsKey,
    row: (rowId: string, cursor: string | null) => [...rowsKey(), rowId, cursor] as const,
  } as const;
}

export type MediaQueryKeys<NS extends string = string> = ReturnType<
  typeof createMediaQueryKeys<NS>
>;
