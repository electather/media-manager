import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { m } from "@/paraglide/messages";
import { fetchTriggerJob } from "../lib/fetchers";
import { jobsKeys } from "../lib/query-keys";
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
      // `JobsApiError` already resolves the server reason into `err.message`
      // (body.message → body.devMessage → generic), so a bare `Error` is the
      // only case left to backstop here.
      toast.error(err.message || m.jobs_trigger_error_generic());
    },
  });
}
