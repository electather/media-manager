import { useMutation } from "@tanstack/react-query";
import { requestsApi } from "./client";
import { toastFromError } from "./errors";

/**
 * Submission mutation. Deliberately does NOT invalidate `requestFlowKeys.targets`:
 * a successful create does not change the target/profile list, and forcing
 * an invalidation would unmount the picker mid-success-toast.
 */
export function useCreateRequest() {
  return useMutation({
    mutationFn: (body: Parameters<typeof requestsApi.create>[0]) => requestsApi.create(body),
    onError: toastFromError,
  });
}
