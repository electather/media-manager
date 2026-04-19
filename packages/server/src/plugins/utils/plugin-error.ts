import type { HostErrorCode } from "../../errors/codes";

export function pluginError(code: HostErrorCode, message: string): Error {
  const err = new Error(message);
  err.name = "PluginError";
  (err as Error & { code: HostErrorCode }).code = code;
  return err;
}

export function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
