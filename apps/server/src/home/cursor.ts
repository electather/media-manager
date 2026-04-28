import { z } from "zod";
import { ROW_KINDS, type RowKind } from "@ent-mcp/shared/home";
import { badRequest } from "../errors/http-errors";

/**
 * Opaque cursor codec. Cursors travel as base64-encoded JSON; clients see
 * them as strings only and never decode them. The shape carries:
 *   - `v` — schema version. Today always `1`. Future migrations bump this and
 *     gracefully drop unknown values during decode.
 *   - `r` — `RowKind` the cursor was minted for. Mismatching `r` against the
 *     `rowId` in the request input is a `home.bad_input`; same-row replay is
 *     fine.
 *   - one of the variant fields (`p`, `o`, `a`+`ts`, `p`+`s`, `p`+`x`).
 *
 * Cursors are NOT HMAC-signed: the RPC layer authenticates with a session
 * cookie, so the cursor is never the capability token. The strict Zod schemas
 * cap every list and number to small bounds so a crafted cursor cannot pin
 * memory or trigger O(N²) work.
 */

const MEDIA_ID_PATTERN = /^(movie|tv):[A-Za-z0-9_-]+$/;

const baseFields = {
  v: z.literal(1),
  r: z.enum(ROW_KINDS),
} as const;

/** `continueWatching`, `yourWatchlist` — offset into a sorted list. */
const offsetCursor = z
  .object({
    ...baseFields,
    o: z.number().int().nonnegative(),
  })
  .strict();

/** `trendingNow`, `newReleases` — page index against an upstream paginator. */
const pageCursor = z
  .object({
    ...baseFields,
    p: z.number().int().nonnegative(),
  })
  .strict();

/** `becauseYouWatched` — page plus the seed media id pinned for the session. */
const pageSeedCursor = z
  .object({
    ...baseFields,
    p: z.number().int().nonnegative(),
    s: z.string().regex(MEDIA_ID_PATTERN),
  })
  .strict();

/** `recommendedForYou` (live fallback) — page plus IDs returned on prior pages (cap = 60). */
const pageExclusionCursor = z
  .object({
    ...baseFields,
    p: z.number().int().nonnegative(),
    x: z.array(z.string().regex(MEDIA_ID_PATTERN)).max(60),
  })
  .strict();

/**
 * `recommendedForYou` (catalog hydration, V43) — page plus the rec list's
 * profile version. A mismatch between cursor `pv` and the current rec list
 * means the profile rebuilt mid-scroll; the fetcher resets to `p = 0` so
 * the next page is rebuilt from a coherent ranking.
 */
const pageVersionCursor = z
  .object({
    ...baseFields,
    p: z.number().int().nonnegative(),
    pv: z.number().int().nonnegative(),
  })
  .strict();

/**
 * `recommendedForYou` accepts either v1 (live fallback) or v2 (catalog
 * hydration). Decoder narrows by shape; encoder picks a single variant per
 * call so cursors do not cross paths mid-session.
 */
const recommendedForYouCursor = z.union([pageExclusionCursor, pageVersionCursor]);

/** `upcomingForYou` — last `(tmdbId, airsAt)` pair for stable ordering. */
const afterTmdbIdCursor = z
  .object({
    ...baseFields,
    a: z.string().regex(MEDIA_ID_PATTERN),
    ts: z.number().int().positive(),
  })
  .strict();

const ROW_TO_SCHEMA = {
  continueWatching: offsetCursor,
  yourWatchlist: offsetCursor,
  trendingNow: pageCursor,
  newReleases: pageCursor,
  becauseYouWatched: pageSeedCursor,
  recommendedForYou: recommendedForYouCursor,
  upcomingForYou: afterTmdbIdCursor,
} satisfies Record<RowKind, z.ZodTypeAny>;

export type OffsetCursor = z.infer<typeof offsetCursor>;
export type PageCursor = z.infer<typeof pageCursor>;
export type PageSeedCursor = z.infer<typeof pageSeedCursor>;
export type RecommendedForYouCursor = z.infer<typeof recommendedForYouCursor>;
export type AfterTmdbIdCursor = z.infer<typeof afterTmdbIdCursor>;

/**
 * Type-level mapping from row kind to the cursor variant it accepts.
 * Written as a distributive conditional so `CursorFor<"continueWatching">`
 * narrows to the offset shape directly rather than collapsing into the
 * union of every variant — TypeScript's indexed-access narrowing through a
 * `Record`-shaped const lookup loses the row→schema correspondence.
 */
export type CursorFor<R extends RowKind> = R extends "continueWatching" | "yourWatchlist"
  ? OffsetCursor
  : R extends "trendingNow" | "newReleases"
    ? PageCursor
    : R extends "becauseYouWatched"
      ? PageSeedCursor
      : R extends "recommendedForYou"
        ? RecommendedForYouCursor
        : R extends "upcomingForYou"
          ? AfterTmdbIdCursor
          : never;

/**
 * Encodes a cursor payload as `base64url`. We accept the raw payload object
 * — encode is the dual of decode and the same Zod schema validates it on
 * the way out, so an over-budget exclusion list cannot escape via a programming
 * mistake.
 */
export function encodeCursor<R extends RowKind>(rowId: R, payload: CursorFor<R>): string {
  const schema = ROW_TO_SCHEMA[rowId] as z.ZodTypeAny;
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw badRequest("home.internal", `cursor encode failed for ${rowId}: ${parsed.error.message}`);
  }
  return Buffer.from(JSON.stringify(parsed.data), "utf8").toString("base64url");
}

/**
 * Decodes an opaque cursor string against the expected `rowId`. Returns the
 * typed payload; throws `home.bad_input` for malformed base64, malformed
 * JSON, schema-violating payloads, or `r`/`rowId` mismatch. Same exception
 * for every failure mode keeps the wire surface honest — clients never need
 * to differentiate "you sent garbage" subcategories.
 */
export function decodeCursor<R extends RowKind>(rowId: R, raw: string): CursorFor<R> {
  let json: unknown;
  try {
    const buf = Buffer.from(raw, "base64url");
    json = JSON.parse(buf.toString("utf8"));
  } catch {
    throw badRequest("home.bad_input", "cursor is not valid base64url JSON");
  }
  const schema = ROW_TO_SCHEMA[rowId] as z.ZodTypeAny;
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw badRequest("home.bad_input", `cursor failed validation: ${parsed.error.message}`);
  }
  const decoded = parsed.data as { r: RowKind };
  if (decoded.r !== rowId) {
    throw badRequest("home.bad_input", `cursor rowId ${decoded.r} does not match ${rowId}`);
  }
  return parsed.data as CursorFor<R>;
}
