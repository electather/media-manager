import { z } from "zod";
import type { MediaType } from "./enums";

/**
 * Single opaque cursor for media read pipeline (design §A5, replaces three forked codecs).
 * Shared for V.WIRE1 invariant; keyset mode carries seed in `k`, offset carries index `n`.
 * `decode` never throws (V.CU1)—returns null for bad input. Uses isomorphic base64url
 * (TextEncoder+btoa, no Node Buffer) for browser safety, matching Node's base64url for interop.
 */

export type CursorMode = "keyset" | "offset";

export type Cursor = { mode: "keyset"; k: string } | { mode: "offset"; n: number };

// `n` must be a non-negative integer: `paginateOffset` uses it directly as an
// `Array.slice` start index, so a hand-crafted `{n:-10}` (slice-from-tail) or
// `{n:1.5}` (truncated to 1, mints a poisoned next cursor) would otherwise
// bypass the documented bad-cursor path (home → 400, watchlist → first page).
const cursorSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("keyset"), k: z.string() }),
  z.object({ mode: z.literal("offset"), n: z.number().int().nonnegative() }),
]);

// Exported (not in the package barrel) so the legacy `@nama/shared/home`
// cursor encoder consumes this one copy instead of duplicating it — the codec
// move consolidates the helper rather than forking it.
export function utf8ToBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

function base64UrlToUtf8(input: string): string {
  let base64 = input.replace(/-/gu, "+").replace(/_/gu, "/");
  const remainder = base64.length % 4;
  // A base64url string with `length % 4 === 1` cannot be valid; the caller's
  // try/catch turns the thrown error into the V.CU1 null path.
  if (remainder === 1) throw new Error("invalid base64url length");
  if (remainder !== 0) base64 += "=".repeat(4 - remainder);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function encode(cursor: Cursor): string {
  return utf8ToBase64Url(JSON.stringify(cursor));
}

/** Hard cap on encoded cursor (512 bytes) prevents multi-megabyte attacker strings from
 * forcing heap allocation on every paginated request. Well-formed cursors are ~50-100 bytes,
 * so 512 is headroom; null return follows V.CU1 path already handled by consumers. */
const MAX_RAW_CURSOR_LEN = 512;

/** Decode cursor; never throws (invariant V.CU1). Returns null if input is not valid
 * base64url JSON, fails schema validation, or (when expectedMode is supplied) mode mismatch. */
export function decode(raw: string, expectedMode?: CursorMode): Cursor | null {
  if (raw.length > MAX_RAW_CURSOR_LEN) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(base64UrlToUtf8(raw));
  } catch {
    return null;
  }
  const result = cursorSchema.safeParse(parsed);
  if (!result.success) return null;
  if (expectedMode !== undefined && result.data.mode !== expectedMode) return null;
  return result.data;
}

/** Mints initial keyset cursor for similar-feed, shared by server `similar-paged` and client
 * detail page for identical encoding (closes `similarTo` gap, consolidation §H). Seed rides
 * in keyset `k` as JSON; home-private `decodeSeedToken` decodes source-side. */
export function encodeSeedCursor(seed: { seedId: string; seedType: MediaType }): string {
  return encode({ mode: "keyset", k: JSON.stringify({ ...seed, offset: 0 }) });
}
