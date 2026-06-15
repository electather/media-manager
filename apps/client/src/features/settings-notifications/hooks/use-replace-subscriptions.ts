import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { NotificationCategory } from "@nama/shared/notifications";
import { fetchToggleSubscription } from "@/features/notifications/shared/fetchers";
import { notificationsKeys } from "@/features/notifications/shared/query-keys";

interface CategoryChange {
  category: NotificationCategory;
  enabled: boolean;
}

interface ReplaceInput {
  connectionId: string;
  changes: CategoryChange[];
}

interface SubscriptionsLikeData {
  subscriptions: Array<{
    connectionId: string;
    category: NotificationCategory;
    enabled: boolean;
  }>;
}

function applyChanges(
  data: SubscriptionsLikeData,
  connectionId: string,
  changes: CategoryChange[],
): SubscriptionsLikeData {
  const next = data.subscriptions.slice();
  for (const change of changes) {
    const idx = next.findIndex(
      (s) => s.connectionId === connectionId && s.category === change.category,
    );
    if (idx >= 0) {
      next[idx] = { ...next[idx]!, enabled: change.enabled };
    } else {
      next.push({ connectionId, category: change.category, enabled: change.enabled });
    }
  }
  return { ...data, subscriptions: next };
}

// Toggling several categories at once (the normal multi-select ToggleGroup
// interaction) used to fire one independent mutation per changed category
// against the same `subscriptions` cache key, racing each other's optimistic
// snapshots and invalidations. This applies the whole diff under a single
// optimistic lifecycle: one snapshot, one patch, one rollback, one
// invalidation, with the per-category PUTs issued together inside `mutationFn`.
export function useReplaceSubscriptions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ReplaceInput) => {
      await Promise.all(
        input.changes.map((change) =>
          fetchToggleSubscription({
            connectionId: input.connectionId,
            category: change.category,
            enabled: change.enabled,
          }),
        ),
      );
    },
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: notificationsKeys.subscriptions() });
      const prev = qc.getQueryData<SubscriptionsLikeData>(notificationsKeys.subscriptions());
      qc.setQueryData<SubscriptionsLikeData>(notificationsKeys.subscriptions(), (data) =>
        data ? applyChanges(data, input.connectionId, input.changes) : data,
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(notificationsKeys.subscriptions(), ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: notificationsKeys.subscriptions() });
    },
  });
}
