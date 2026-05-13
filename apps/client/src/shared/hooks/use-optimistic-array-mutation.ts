import {
  useMutation,
  useQueryClient,
  type QueryKey,
  type UseMutationOptions,
} from "@tanstack/react-query";

interface OptimisticArrayMutationOptions<TItem, TInput, TData> {
  queryKey: QueryKey;
  mutationFn: (input: TInput) => Promise<TData>;
  /** Pure transform applied to the cached array before the server replies. */
  update: (prev: TItem[], input: TInput) => TItem[];
  onSuccess?: UseMutationOptions<TData, Error, TInput, { prev: TItem[] | undefined }>["onSuccess"];
}

/**
 * React Query mutation helper for the common "optimistically transform a
 * top-level cached array, roll back on error, invalidate on settle" pattern.
 * Used by single-resource delete/toggle flows whose cache shape is `TItem[]`.
 */
export function useOptimisticArrayMutation<TItem, TInput, TData = unknown>(
  opts: OptimisticArrayMutationOptions<TItem, TInput, TData>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: opts.mutationFn,
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: opts.queryKey });
      const prev = qc.getQueryData<TItem[]>(opts.queryKey);
      if (prev) {
        qc.setQueryData<TItem[]>(opts.queryKey, opts.update(prev, input));
      }
      return { prev };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.prev) qc.setQueryData(opts.queryKey, ctx.prev);
    },
    onSuccess: opts.onSuccess,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: opts.queryKey });
    },
  });
}
