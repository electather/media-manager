import { badRequest, conflict, forbidden, notFound } from "../errors/http-errors";
import type { HttpError } from "../errors/http-errors";

/** UserFacingError constructors for job.* codes. Kept here so callers do not
 *  have to re-assemble the (code, message, params) triple. */
export const jobErrors = {
  notFound(jobId: string): HttpError {
    return notFound("job.not_found", `job ${jobId} is not registered`, { jobId });
  },
  alreadyRunning(jobId: string, scopeKey?: string): HttpError {
    return conflict("job.already_running", `job ${jobId} is already running`, {
      jobId,
      ...(scopeKey ? { scopeKey } : {}),
    });
  },
  disabled(jobId: string): HttpError {
    return conflict("job.disabled", `job ${jobId} is disabled`, { jobId });
  },
  badInput(message: string): HttpError {
    return badRequest("job.bad_input", message);
  },
  wrongKind(jobId: string, message: string): HttpError {
    return badRequest("job.wrong_kind", message, { jobId });
  },
  forbidden(): HttpError {
    return forbidden("job.forbidden", "forbidden");
  },
};
