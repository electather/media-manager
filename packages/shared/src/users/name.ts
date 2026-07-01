import { NAME_MAX_LENGTH } from "./schemas";

/**
 * Truncate a display name to at most NAME_MAX_LENGTH UTF-16 code units without
 * splitting a surrogate pair. The limit stays UTF-16-based to mirror the Zod
 * `z.string().max(NAME_MAX_LENGTH)` guard (which measures String.length) — a
 * code-point limit would accept strings the guard rejects and diverge from the
 * API-layer contract. If the boundary lands mid-pair (a high surrogate at the
 * last kept index), drop that lone unit so we never emit a lone surrogate.
 */
export function truncateName(name: string): string {
  if (name.length <= NAME_MAX_LENGTH) return name;
  // 0xD800–0xDBFF is the high-surrogate range; a high surrogate at the last
  // kept index means its low-surrogate mate would be cut off, so exclude it.
  const lastKept = name.charCodeAt(NAME_MAX_LENGTH - 1);
  const end = lastKept >= 0xd800 && lastKept <= 0xdbff ? NAME_MAX_LENGTH - 1 : NAME_MAX_LENGTH;
  return name.slice(0, end);
}
