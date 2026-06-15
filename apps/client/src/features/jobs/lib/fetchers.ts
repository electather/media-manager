import { api } from "@/shared/lib/api";
import { readOkJson } from "@/shared/lib/api/throw-on-error";
import { JobsApiError } from "./types";
import type { FormFieldValue } from "./types";

const readJson = <R extends Response>(res: R) => readOkJson(res, JobsApiError);

/** Sends a trigger request for the given job and returns the server response.
 *
 * Throws a `JobsApiError` on any non-OK HTTP response so callers receive a
 * typed error with status and server-provided message rather than a bare
 * string.
 */
export async function fetchTriggerJob(
  jobId: string,
  input: Record<string, FormFieldValue> | null,
): Promise<{ runId?: string }> {
  return readJson(
    await api.admin.jobs[":id"].trigger.$post({
      param: { id: jobId },
      json: input,
    }),
  ) as Promise<{ runId?: string }>;
}
