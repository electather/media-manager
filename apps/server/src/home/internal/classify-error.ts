import type { HostErrorCode } from "@nama/shared/diagnostics";
import { isPluginError } from "@nama/plugin-sdk";
import { AllPluginsFailedError, PluginCallError } from "../../media";
import { HttpError } from "../../diagnostics/http-errors";

/**
 * Maps thrown value to `HostErrorCode` for `MediaDetailsResponse.error`.
 * Order matters: AllPluginsFailedError must be checked before HttpError (now extends HttpError with status 503),
 * then AbortError → timeout, else generic fallback. Unknown → `home.internal` for correct captureError severity.
 */
// fallow-ignore-next-line complexity
export function classifyError(err: unknown): HostErrorCode {
  // AllPluginsFailedError must be checked before HttpError — it now extends
  // HttpError (status 503 / `media.providers_failed`) so the per-provider
  // error code is only reachable via this branch.
  if (err instanceof AllPluginsFailedError) {
    return err.errors[0]?.code ?? "plugin.upstream_error";
  }
  if (err instanceof HttpError) {
    return err.code as HostErrorCode;
  }
  if (err instanceof PluginCallError) return err.code;
  if (isPluginError(err)) return err.code as HostErrorCode;
  if (err instanceof Error && err.name === "AbortError") return "plugin.timeout";
  return "home.internal";
}
