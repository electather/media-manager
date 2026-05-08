import { toast } from "sonner";
import * as m from "@/paraglide/messages";
import type { ApiErrorBody } from "@/shared/lib/errors/api-error-body";

/** Typed error thrown by `requestsApi.*` on non-2xx responses. */
export class RequestError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly body: ApiErrorBody | null;

  constructor(status: number, body: ApiErrorBody | null) {
    super(body?.message ?? `Request API failed (${status})`);
    this.name = "RequestError";
    this.status = status;
    this.code = body?.code;
    this.body = body;
  }
}

/** Maps a `RequestError` (or generic error) onto a destructive toast. */
export function toastFromError(err: unknown): void {
  const code = err instanceof RequestError ? err.code : undefined;
  let title: string;
  switch (code) {
    case "request.invalid_input":
      title = m.request_error_invalid_input();
      break;
    case "request.unknown_service":
      title = m.request_error_unknown_service();
      break;
    case "request.invalid_profile":
      title = m.request_error_invalid_profile();
      break;
    case "request.provider_failed":
      title = m.request_error_provider_failed();
      break;
    default:
      title = m.request_error_generic();
  }
  const description = err instanceof Error ? err.message : String(err);
  toast.error(title, { description });
}
