import { api } from "@/shared/lib/api";
import { readOkJson } from "@/shared/lib/api/throw-on-error";
import { JobsApiError } from "./types";
import type { FormFieldValue } from "./types";

const readJson = <R extends Response>(res: R) => readOkJson(res, JobsApiError);

// Throws JobsApiError with typed status and message, not bare strings.
export async function fetchTriggerJob(
  jobId: string,
  input: Record<string, FormFieldValue> | null,
): Promise<{ runId?: string }> {
  // No cast — the return type flows from Hono's inferred res.json() via
  // readOkJson and is enforced by this function's return-type annotation.
  return readJson(
    await api.admin.jobs[":id"].trigger.$post({
      param: { id: jobId },
      json: input,
    }),
  );
}
