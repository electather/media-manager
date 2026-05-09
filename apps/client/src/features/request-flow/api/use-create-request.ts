import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CreateMediaRequestBody,
  MediaRequest,
  MediaRequestsResponse,
} from "@ent-mcp/shared/media";
import { requestsApi } from "./client";
import { requestFlowKeys } from "./query-keys";
import { toastFromError } from "./errors";

interface CreateVars extends CreateMediaRequestBody {
  /** UI-only label hints carried into the optimistic + seeded cache row. */
  serviceLabel?: string | null;
  profileLabel?: string | null;
}

interface CreateContext {
  prev: MediaRequestsResponse | undefined;
  optimisticId: string;
}

/**
 * Submission mutation. Writes an optimistic `__optimistic-*` row into the
 * history cache so the UI flips to pending instantly; rolls back on error.
 * On success the optimistic row is replaced with the real `requestId` and
 * the labels carried in `vars`, then we deliberately skip invalidating
 * `requestFlowKeys.history()` — Seerr can lag indexing a freshly-created
 * request, so refetching here races against a still-empty list and reverts
 * the UI to the request button. The seeded row plus `staleTime` +
 * focus-refetch on `useUserRequests` reconcile labels later without that
 * flicker.
 */
export function useCreateRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ serviceLabel: _s, profileLabel: _p, ...body }: CreateVars) =>
      requestsApi.create(body),
    onMutate: async (vars): Promise<CreateContext> => {
      await qc.cancelQueries({ queryKey: requestFlowKeys.history() });
      const prev = qc.getQueryData<MediaRequestsResponse>(requestFlowKeys.history());
      const optimisticId = `__optimistic-${crypto.randomUUID()}`;
      const row: MediaRequest = {
        id: optimisticId,
        tmdbId: vars.tmdbId,
        type: vars.mediaType,
        title: "",
        status: "pending",
        seasons: vars.seasons ?? [],
        targetLabel: vars.serviceLabel ?? null,
        profileLabel: vars.profileLabel ?? null,
        createdAt: new Date().toISOString(),
      };
      qc.setQueryData<MediaRequestsResponse>(requestFlowKeys.history(), (old) => ({
        items: [...(old?.items ?? []), row],
      }));
      return { prev, optimisticId };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(requestFlowKeys.history(), ctx.prev);
      toastFromError(err);
    },
    onSuccess: (data, vars, ctx) => {
      // Replace the optimistic row with a real-id row carrying the user's
      // chosen labels. We do NOT invalidate — see header comment.
      qc.setQueryData<MediaRequestsResponse>(requestFlowKeys.history(), (old) => {
        const items = (old?.items ?? []).map((r) =>
          r.id === ctx?.optimisticId
            ? {
                ...r,
                id: data.requestId ?? r.id,
                targetLabel: vars.serviceLabel ?? r.targetLabel,
                profileLabel: vars.profileLabel ?? r.profileLabel,
              }
            : r,
        );
        return { items };
      });
    },
  });
}
