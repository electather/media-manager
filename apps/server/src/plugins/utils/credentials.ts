import { pluginError } from "./plugin-error";

export function resolveCredential(
  primary: string | undefined,
  fallback: string | undefined,
  errorMessage: string,
): string {
  const value = primary ?? fallback;
  if (!value) throw pluginError("plugin.bad_credentials", errorMessage);
  return value;
}
