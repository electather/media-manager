import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { MediaRequestsResponse } from "@ent-mcp/shared/media";
import { requestsApi } from "./client";
import { requestFlowKeys } from "./query-keys";
import { toastFromError } from "./errors";

interface CreateContext {
  prev: MediaRequestsResponse | undefined;
}

/**
 * Submission mutation. Writes an optimistic `__optimistic-*` row into the
 * history cache so the UI flips to pending instantly; rolls back on error;
 * invalidates `requestFlowKeys.history()` on success so the real id +
 * destination labels hydrate. Deliberately does NOT invalidate
 * `requestFlowKeys.targets`: a successful create does not change the
 * target/profile list, and forcing an invalidation would unmount the picker
 * mid-success-toast.
 */
export function useCreateRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Parameters<typeof requestsApi.create>[0]) => requestsApi.create(body),
    onMutate: async (vars): Promise<CreateContext> => {
      await qc.cancelQueries({ queryKey: requestFlowKeys.history() });
      const prev = qc.getQueryData<MediaRequestsResponse>(requestFlowKeys.history());
      qc.setQueryData<MediaRequestsResponse>(requestFlowKeys.history(), (old) => ({
        items: [
          ...(old?.items ?? []),
          {
            id: `__optimistic-${crypto.randomUUID()}`,
            tmdbId: vars.tmdbId,
            type: vars.mediaType,
            title: "",
            status: "pending" as const,
            seasons: vars.seasons ?? [],
            targetLabel: null,
            profileLabel: null,
            createdAt: new Date().toISOString(),
          },
        ],
      }));
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(requestFlowKeys.history(), ctx.prev);
      toastFromError(err);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: requestFlowKeys.history() });
    },
  });
}
