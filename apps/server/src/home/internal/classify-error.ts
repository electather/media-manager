import type { HostErrorCode } from "@ent-mcp/shared/diagnostics";
import { isPluginError } from "@ent-mcp/plugin-sdk";
import { AllPluginsFailedError, PluginCallError } from "../../media";
import { HttpError } from "../../diagnostics/http-errors";

/**
 * Maps a thrown value to the `HostErrorCode` the home-feed wire surfaces on
 * `MediaDetailsResponse.error`. The orchestrator catches plugin failures
 * during detail composition and stamps the code so the client can render the
 * correct retry copy.
 *
 * Order matters: structured plugin errors carry their own code, then
 * AbortError → timeout, then the generic upstream fallback. Unknown shapes
 * default to `home.internal` so the captureError boundary sees them with the
 * right severity.
 */
// fallow-ignore-next-line complexity
export function classifyError(err: unknown): HostErrorCode {
  if (err instanceof HttpError) {
    return (err.code as HostErrorCode) ?? "home.internal";
  }
  if (err instanceof PluginCallError) return err.code;
  if (err instanceof AllPluginsFailedError) {
    return err.errors[0]?.code ?? "plugin.upstream_error";
  }
  if (isPluginError(err)) return err.code as HostErrorCode;
  if (err instanceof Error && err.name === "AbortError") return "plugin.timeout";
  return "home.internal";
}
