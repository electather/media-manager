import { z } from "zod";

/**
 * The single opaque page cursor for the media read pipeline. It replaces the
 * three forked codecs (home-feed offset, watchlist keyset, watchlist
 * offset-snapshot) with one base64url-JSON, zod-validated format (design §E).
 *
 * A keyset cursor carries its hop position — and any source-specific seed
 * (moodId, feed seedId/seedType, sort) — inside the opaque `k` string, exactly
 * as `becauseYouWatched` carries its seed today, so no source needs a private
 * codec. An offset cursor carries the in-memory slice index `n`.
 *
 * `decode` NEVER throws (invariant V.CU1): bad, foreign, or mode-mismatched
 * input returns `null`. The 400-vs-empty decision stays with the consumer —
 * home feed maps `null → HttpError 400`, watchlist maps `null → first-page` —
 * preserving today's per-consumer split.
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

export function encode(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
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
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const result = cursorSchema.safeParse(parsed);
  if (!result.success) return null;
  if (expectedMode !== undefined && result.data.mode !== expectedMode) return null;
  return result.data;
}
