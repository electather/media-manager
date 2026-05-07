# React Query

## Suspense reads vs `useQuery`

Default to Suspense. The page wraps the consumer in `<Suspense fallback={<Skeleton/>}>` and the feature ErrorBoundary; the data hook uses `useSuspenseQuery` or `useSuspenseInfiniteQuery`.

```ts
// inbox/use-inbox.ts
import { useSuspenseInfiniteQuery } from "@tanstack/react-query";
import { fetchInboxPage } from "../shared/fetchers";
import { notificationsKeys } from "../shared/query-keys";
import type { InboxFilters } from "../shared/types";

export function useInbox(filters: InboxFilters) {
  return useSuspenseInfiniteQuery({
    queryKey: notificationsKeys.inbox(filters),
    queryFn: ({ pageParam }) => fetchInboxPage(filters, pageParam ?? null),
    initialPageParam: null as string | null,
    getNextPageParam: (last) =>
      "nextCursor" in last && typeof last.nextCursor === "string" ? last.nextCursor : null,
  });
}
```

Use plain `useQuery` only when:

- The query is optional (e.g. unread count badge that should not block the page).
- The query polls and the consumer is okay with intermittent data (e.g. notification bell).
- The query is below a Suspense boundary that already exists for sibling data, and adding another would harm UX.

```ts
// bell/use-unread-count.ts
import { useQuery } from "@tanstack/react-query";
import { fetchUnreadCount } from "../shared/fetchers";
import { notificationsKeys } from "../shared/query-keys";

export function useUnreadCount() {
  return useQuery({
    queryKey: notificationsKeys.unreadCount(),
    queryFn: fetchUnreadCount,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    networkMode: "online",
    staleTime: 15_000,
  });
}
```

## Polling pattern

```ts
useQuery({
  queryKey,
  queryFn,
  refetchInterval: 30_000,           // chosen value, document in a comment
  staleTime: 15_000,                 // half of refetchInterval is a fine default
  networkMode: "online",             // skip polling when offline
  refetchIntervalInBackground: false // skip polling when tab is hidden
});
```

Document the interval at the hook (top-of-file comment or right above the call) with the reasoning ("matches server warm-job cadence", "unread badge does not need sub-30s freshness", etc.).

## Infinite queries

Cursor-based pagination is the default. The fetcher accepts the cursor; the hook drives `pageParam`.

```ts
return useSuspenseInfiniteQuery({
  queryKey: notificationsKeys.inbox(filters),
  queryFn: ({ pageParam }) => fetchInboxPage(filters, pageParam ?? null),
  initialPageParam: null as string | null,
  getNextPageParam: (last) =>
    typeof last.nextCursor === "string" ? last.nextCursor : null,
});
```

The list component handles virtualization and triggers `fetchNextPage` from a sentinel row. Reference: [`apps/client/src/features/notifications/inbox/inbox-list.tsx`](../../../../apps/client/src/features/notifications/inbox/inbox-list.tsx).

## Optimistic mutations

Mandatory for user-perceived state — anything the user clicks and expects to update immediately (toggles, mark-read, dismiss, edit).

Heuristic: if there's any chance the user waits more than ~100ms before the UI reflects their action, the mutation MUST be optimistic.

Recipe:

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchMarkRead } from "../shared/fetchers";
import { notificationsKeys } from "../shared/query-keys";

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => fetchMarkRead(ids),

    onMutate: async (ids) => {
      // 1. Cancel in-flight fetches that could overwrite our optimistic patch.
      await qc.cancelQueries({ queryKey: notificationsKeys.inboxAll() });

      // 2. Snapshot — capture all matching cache entries so we can restore on error.
      const snapshot = qc.getQueriesData<InboxLikeData>({
        queryKey: notificationsKeys.inboxAll(),
      });

      // 3. Patch — apply the optimistic update across all matching cache entries.
      const idSet = new Set(ids);
      const now = Date.now();
      qc.setQueriesData<InboxLikeData>(
        { queryKey: notificationsKeys.inboxAll() },
        (data) => applyToPages(data, setReadAt(idSet, now)),
      );

      // 4. Return the snapshot so onError can restore.
      return { snapshot };
    },

    onError: (_err, _vars, ctx) => {
      // 5. Roll back — restore every snapshotted cache entry.
      if (ctx?.snapshot) {
        for (const [key, data] of ctx.snapshot) qc.setQueryData(key, data);
      }
    },

    onSettled: () => {
      // 6. Invalidate so the server state reconciles whatever the optimistic patch missed.
      void qc.invalidateQueries({ queryKey: notificationsKeys.inboxAll() });
      void qc.invalidateQueries({ queryKey: notificationsKeys.unreadCount() });
    },
  });
}
```

Reference: [`apps/client/src/features/notifications/inbox/use-inbox-mutations.ts`](../../../../apps/client/src/features/notifications/inbox/use-inbox-mutations.ts).

### Snapshot vs single-key patch

Two shapes:

- **Single-key patch** when the mutation only touches one query: snapshot via `qc.getQueryData`, restore via `qc.setQueryData`. See `useToggleSubscription` in notifications.
- **Multi-key patch** when the mutation may touch multiple cached variants (different filters, popover + page): use `qc.getQueriesData({ queryKey: <prefix>() })` and `qc.setQueriesData({ queryKey: <prefix>() }, fn)`. See `useMarkRead` above.

The query-keys factory's `<thing>All()` helpers exist to drive multi-key patches: they return the prefix without the filter discriminator.

### When invalidate-only is OK

Background or low-stakes mutations where the user does not expect an instant UI change:

```ts
return useMutation({
  mutationFn: (body) => fetchUpdateAdminSettings(body),
  onSettled: () => qc.invalidateQueries({ queryKey: notificationsKeys.admin.settings() }),
});
```

Examples: saving retention settings, posting an audit note, batch deletes triggered by a confirm dialog.

## Toasts

Show a toast on mutation error (and success when it's the user's only feedback signal). Reference [`fetchDeleteInboxAll`](../../../../apps/client/src/features/notifications/inbox/use-inbox-mutations.ts) — `onError` shows a sonner toast with the error message.

## See also

- [`data-layer.md`](data-layer.md) for fetchers + query-keys factory.
- [`composition.md`](composition.md) for Suspense + ErrorBoundary placement at the page.
- Companion skill: `vercel-react-best-practices` for waterfall avoidance, parallel queries.
