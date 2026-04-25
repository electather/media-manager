import { HostErrorCode } from "@ent-mcp/shared/errors";
import { pluginError } from "./plugin-error";

interface HandleHttpStatusOptions {
  on401?: HostErrorCode;
  on403?: HostErrorCode;
}

export function handleHttpStatus(
  res: Response,
  service: string,
  opts?: HandleHttpStatusOptions,
): void {
  if (res.status === 401 && opts?.on401) {
    throw pluginError(opts.on401, `${service} auth rejected (401)`);
  }
  if (res.status === 403 && opts?.on403) {
    throw pluginError(opts.on403, `${service} auth rejected (403)`);
  }
  if (res.status === 404) {
    throw pluginError("plugin.item_not_found", `${service} not found (404)`);
  }
  if (res.status === 429) {
    throw pluginError("plugin.rate_limited", `${service} rate limited (429)`);
  }
  if (res.status >= 500) {
    throw pluginError("plugin.upstream_error", `${service} server error (${res.status})`);
  }
}
