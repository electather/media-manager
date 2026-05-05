import { m } from "@/paraglide/messages";

import type { StaticMessageKey } from "./types";

/**
 * Resolves a parameter-less Paraglide message by key. Indexed access narrows
 * to a union of every message signature, which TypeScript can't call with no
 * args — the `StaticMessageKey` constraint already filters to zero-arity
 * messages, so the cast is safe.
 */
export function t(key: StaticMessageKey): string {
  const fn = m[key] as () => string;
  return fn();
}
