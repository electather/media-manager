import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { MediaRequestsResponse } from "@nama/shared/media";
import { requestsApi } from "./client";
import { requestFlowKeys } from "./query-keys";
import { toastFromError } from "./errors";

interface CancelInput {
  requestId: string;
}

interface CancelContext {
  prev: MediaRequestsResponse | undefined;
}

/**
 * Cancel mutation. Short-circuits when the row is still optimistic
 * (`__optimistic-*`) — the create POST has not yet settled, so there is no
 * server-side row to cancel; only the local cache is filtered. Real ids hit
 * `DELETE /api/requests/:id`.
 */
export function useCancelRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ requestId }: CancelInput) => {
      if (requestId.startsWith("__optimistic-")) {
        return { ok: true as const, synthetic: true as const };
      }
      const out = await requestsApi.cancel(requestId);
      return { ...out, synthetic: false as const };
    },
    onMutate: async ({ requestId }: CancelInput): Promise<CancelContext> => {
      await qc.cancelQueries({ queryKey: requestFlowKeys.history() });
      const prev = qc.getQueryData<MediaRequestsResponse>(requestFlowKeys.history());
      qc.setQueryData<MediaRequestsResponse>(requestFlowKeys.history(), (old) => ({
        items: (old?.items ?? []).filter((r) => r.id !== requestId),
      }));
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(requestFlowKeys.history(), ctx.prev);
      toastFromError(err);
    },
    onSuccess: (data) => {
      if (data?.synthetic) return;
      void qc.invalidateQueries({ queryKey: requestFlowKeys.history() });
    },
  });
}
