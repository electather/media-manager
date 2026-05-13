import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { NotificationCategory } from "@ent-mcp/shared/notifications";
import { fetchToggleSubscription } from "@/features/notifications/shared/fetchers";
import { notificationsKeys } from "@/features/notifications/shared/query-keys";

interface ToggleInput {
  connectionId: string;
  category: NotificationCategory;
  enabled: boolean;
}

interface SubscriptionsLikeData {
  subscriptions: Array<{
    connectionId: string;
    category: NotificationCategory;
    enabled: boolean;
  }>;
}

export function useToggleSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ToggleInput) => fetchToggleSubscription(input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: notificationsKeys.subscriptions() });
      const prev = qc.getQueryData<SubscriptionsLikeData>(notificationsKeys.subscriptions());
      qc.setQueryData<SubscriptionsLikeData>(notificationsKeys.subscriptions(), (data) => {
        if (!data) return data;
        const idx = data.subscriptions.findIndex(
          (s) => s.connectionId === input.connectionId && s.category === input.category,
        );
        const next = data.subscriptions.slice();
        if (idx >= 0) {
          next[idx] = { ...next[idx]!, enabled: input.enabled };
        } else {
          next.push({
            connectionId: input.connectionId,
            category: input.category,
            enabled: input.enabled,
          });
        }
        return { ...data, subscriptions: next };
      });
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
