import { toast } from "sonner";
import * as m from "@/paraglide/messages";
import { RequestError } from "../lib/types";

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
    case "request.provider_failed":
      title = m.request_error_provider_failed();
      break;
    default:
      title = m.request_error_generic();
  }
  const description = err instanceof Error ? err.message : String(err);
  toast.error(title, { description });
}
