import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { m } from "@/paraglide/messages";
import { fetchTriggerJob } from "../lib/fetchers";
import { jobsKeys } from "../lib/query-keys";
import { JobsApiError } from "../lib/types";
import type { FormFieldValue } from "../lib/types";

/** Fires a manual trigger for a job.
 *
 * On success, invalidates all jobs queries so the run list refreshes.
 * On error, surfaces the server-provided message (or a generic fallback)
 * via a sonner error toast so the user always knows the trigger failed.
 */
export function useTriggerJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      jobId,
      input,
    }: {
      jobId: string;
      input: Record<string, FormFieldValue> | null;
    }) => fetchTriggerJob(jobId, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jobsKeys.all });
    },
    onError: (err) => {
      const msg =
        err instanceof JobsApiError && err.body?.message
          ? err.body.message
          : err.message || m.jobs_trigger_error_generic();
      toast.error(msg);
    },
  });
}
