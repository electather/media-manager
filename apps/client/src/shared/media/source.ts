import type { MediaSourceId, Page } from "@nama/shared/media";
import { api } from "@/shared/lib/api";
import { throwOnError } from "./error";

/**
 * A client media source descriptor (design §B1). It mirrors the server
 * `MediaSourceRegistration` so a feature declares each list it reads once —
 * `sourceId`, its request `params`, whether it reads `infinite` (home rows,
 * watchlist items/moods) or as a bounded `section` (tonight/recently), how a
 * null cursor maps, and any client-built `initialCursor` (the `similarTo` seed).
 *
 * `fetchPage` binds the ONE media read endpoint — there is no per-feature
 * fetcher anymore (#509). Build descriptors with `defineMediaSource` so they all
 * share the same bound fetcher.
 */
export interface ClientMediaSource<P> {
  sourceId: MediaSourceId;
  params: P;
  mode: "infinite" | "section";
  /**
   * Mirrors the server registration's `cursorOnNull`. `"throw"` marks the
   * home-origin sources whose resolver rejects a bad cursor with 400;
   * `"firstPage"` marks the watchlist-origin sources that fall to page one.
   */
  cursorOnNull: "throw" | "firstPage";
  /** Non-null only for seeded sources (`similarTo`), minted via `encodeSeedCursor`. */
  initialCursor?: string | null;
  fetchPage(params: P, cursor: string | null): Promise<Page>;
}

/** Fields of a `ClientMediaSource` other than the shared `fetchPage` binding. */
export type MediaSourceSpec<P> = Omit<ClientMediaSource<P>, "fetchPage">;

/**
 * Serialize a source param object into the query the generic resolver parses
 * off the request. Null / undefined fields are dropped (the resolver treats an
 * absent param as unset); strings/numbers are stringified. A `string[]` value
 * is forwarded as-is so the Hono client emits it as repeated params
 * (`?genres=Drama&genres=Crime`), which the resolver reads multi-value — empty
 * arrays are dropped like an unset axis.
 */
// Reason: each branch maps one irreducible param category (string / number /
// non-empty array; everything else is an unset axis the resolver ignores). It
// is exercised by source.test.ts; the flagged CRAP is the export-reference
// coverage estimate, not the real path. Mirrors error.ts's tested constructor.
// fallow-ignore-next-line complexity
function serializeParam(value: unknown): string | string[] | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value) && value.length > 0) return value as string[];
  return undefined;
}

function toQuery(params: Record<string, unknown>): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(params)) {
    const serialized = serializeParam(value);
    if (serialized !== undefined) query[key] = serialized;
  }
  return query;
}

/**
 * Build a `ClientMediaSource` from its spec, binding the one media read endpoint
 * (`GET /api/media/sources/:sourceId`). The cursor rides as a query param when
 * present; the resolver decodes only the opaque outer cursor and re-parses the
 * source params off the query (design §A3). Params may be `string[]` for
 * multi-value axes (the library lens filters), which ride as repeated params.
 */
export function defineMediaSource<
  P extends Record<string, string | string[] | number | null | undefined>,
>(spec: MediaSourceSpec<P>): ClientMediaSource<P> {
  return {
    ...spec,
    async fetchPage(params, cursor) {
      const query = toQuery(params as Record<string, unknown>);
      if (cursor) query.cursor = cursor;
      const res = await api.media.sources[":sourceId"].$get({
        param: { sourceId: spec.sourceId },
        query,
      });
      if (!res.ok) await throwOnError(res);
      return (await res.json()) as Page;
    },
  };
}
