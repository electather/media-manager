import { m } from "@/paraglide/messages";

import type { MessageKey } from "./types";

/**
 * Resolves a parameter-less Paraglide message by key. Indexed access narrows
 * to a union of every message signature, which TypeScript can't call with
 * no args; this cast is safe for the keys we use (page labels, hints, section
 * titles — all of them are static strings).
 */
export function t(key: MessageKey): string {
  const fn = m[key] as () => string;
  return fn();
}
