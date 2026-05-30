import { z } from "zod";
import type { MediaType } from "./enums";

/**
 * The single opaque page cursor for the media read pipeline (design §A5). It
 * replaces the three forked codecs (home-feed offset, watchlist keyset,
 * watchlist offset-snapshot) with one base64url-JSON, zod-validated format.
 *
 * The codec lives in `@ent-mcp/shared/media` so client and server agree on
 * exactly one definition (invariant V.WIRE1). The server `media` barrel
 * re-exports it (`apps/server/src/media/cursor.ts` is a thin re-export) so
 * server-internal consumers keep their barrel import unchanged (V.RG1). The
 * client imports it directly to mint the `similarTo` seed cursor with the same
 * bytes the server expects.
 *
 * A keyset cursor carries its hop position — and any source-specific seed
 * (moodId, feed seedId/seedType, sort) — inside the opaque `k` string, exactly
 * as `becauseYouWatched` carries its seed today, so no source needs a private
 * codec. An offset cursor carries the in-memory slice index `n`.
 *
 * `decode` NEVER throws (invariant V.CU1): bad, foreign, or mode-mismatched
 * input returns `null`. The 400-vs-empty decision stays with the consumer —
 * home feed maps `null → 400`, watchlist maps `null → first-page` — preserving
 * today's per-consumer split.
 *
 * Encoding is isomorphic (base64url over `TextEncoder`/`btoa`, no Node
 * `Buffer`) so the module stays browser-safe per the shared-package rule. The
 * byte string matches Node's `Buffer.toString("base64url")` for the same
 * input, so cursors interoperate across the boundary.
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

function utf8ToBase64Url(input: string): string {
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

/**
 * Hard cap on the encoded cursor input. A well-formed cursor is ~50-100 bytes
 * (mode + a short keyset hop or a small offset), so 512 is generous headroom.
 * The cap stops a multi-megabyte client/attacker string from forcing a large
 * heap allocation and JSON parse on every paginated request. The null return
 * is the V.CU1 path the consumer envelope already handles.
 */
const MAX_RAW_CURSOR_LEN = 512;

/**
 * Decode an opaque cursor string. Returns `null` — never throws — when the
 * input is not valid base64url JSON, fails the schema, or (when
 * `expectedMode` is supplied) decodes to a different mode than the source
 * declared. When `expectedMode` is omitted any valid cursor is returned.
 */
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

/**
 * Mints the initial keyset cursor for a similar-feed row from its seed. Shared
 * by the server `similar-paged` source and the client detail page so both mint
 * the seed cursor identically (closes the `similarTo` cursor gap, consolidation
 * §H). The seed's `{ seedId, seedType, offset }` rides inside the keyset `k`
 * as JSON; the home-private `decodeSeedToken` parses it back source-side.
 */
export function encodeSeedCursor(seed: { seedId: string; seedType: MediaType }): string {
  return encode({ mode: "keyset", k: JSON.stringify({ ...seed, offset: 0 }) });
}
