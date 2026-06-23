import type { MediaSourceId, Page } from "@nama/shared/media";
import { api } from "@/shared/lib/api";
import { throwOnError } from "./error";

/** Client media source descriptor (design §B1). Mirrors server `MediaSourceRegistration`.
 *  `fetchPage` binds the ONE media read endpoint (#509). Use `defineMediaSource` to bind.
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

/** Serialize params into the resolver query. Null/undefined dropped; strings/numbers
 *  stringified; non-empty arrays forwarded as repeated params.
 */
// fallow-ignore-next-line complexity
function serializeParam(value: unknown): string | string[] | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  // The `defineMediaSource<P>` param type constrains every axis element to a
  // string, so a non-empty array is a `string[]`; the cast records that the
  // element type is a caller guarantee, not a runtime check.
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

/** Build a `ClientMediaSource` from spec, binding `GET /api/media/sources/:sourceId`.
 *  Cursor rides as query param; resolver decodes outer cursor and re-parses params (design §A3).
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
