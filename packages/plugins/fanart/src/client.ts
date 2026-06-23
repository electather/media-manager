import { pluginError } from "@nama/plugin-sdk";
import type { Ctx } from "./types";

// Fanart.tv keys are admin-only (no per-user variant); throws plugin.bad_credentials if missing
// so the dispatcher merges the other provider's bundle instead.
export function resolveKey(ctx: Ctx): string {
  const value = ctx.sharedCredentials?.apiKey;
  if (!value) {
    throw pluginError("plugin.bad_credentials", "no fanart.tv api key configured");
  }
  return value;
}

// Fanart returns Retry-After as integer or date; we parse the integer form and default to 60s.
export function parseRetryAfterSec(header: string | null): number {
  if (!header) return 60;
  const n = Number(header);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return 60;
}
