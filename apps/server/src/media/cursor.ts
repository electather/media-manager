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

const cursorSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("keyset"), k: z.string() }),
  z.object({ mode: z.literal("offset"), n: z.number() }),
]);

export function encode(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/**
 * Decode an opaque cursor string. Returns `null` — never throws — when the
 * input is not valid base64url JSON, fails the schema, or (when
 * `expectedMode` is supplied) decodes to a different mode than the source
 * declared. When `expectedMode` is omitted any valid cursor is returned.
 */
export function decode(raw: string, expectedMode?: CursorMode): Cursor | null {
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
