import { pluginError } from "@nama/plugin-sdk";
import type { Ctx } from "./types";

/**
 * Pulls the API key from the shared-credentials pool. Fanart.tv keys are
 * admin-only — there is no per-user variant — so we only consult
 * `sharedCredentials`. Throws `plugin.bad_credentials` when no key is
 * configured so the dispatcher logs the error and merges the other
 * provider's bundle instead.
 */
export function resolveKey(ctx: Ctx): string {
  const value = ctx.sharedCredentials?.apiKey;
  if (!value) {
    throw pluginError("plugin.bad_credentials", "no fanart.tv api key configured");
  }
  return value;
}

/**
 * Parses a `Retry-After` header into seconds. Fanart returns either an
 * integer second count or a date; we honour the integer form and fall back
 * to a 60-second default for anything else so the pool always has a value
 * to wait on.
 */
export function parseRetryAfterSec(header: string | null): number {
  if (!header) return 60;
  const n = Number(header);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return 60;
}
