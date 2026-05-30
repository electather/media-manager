// fallow-ignore-file unused-file
// Reason: this layer lands before its consumers — the source descriptor is wired into the home / watchlist shells in US-008 / US-009.
import type { MediaSourceId, Page } from "@ent-mcp/shared/media";
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
 * Serialize a source param object into the string query the generic resolver
 * parses off `c.req.query()`. Null / undefined fields are dropped (the resolver
 * treats an absent param as unset); everything else is stringified, matching the
 * old per-feature fetchers that hand-built `Record<string, string>` queries.
 */
function toQuery(params: Record<string, unknown>): Record<string, string> {
  const query: Record<string, string> = {};
  // Media source params are flat strings/numbers (`limit` is the only number);
  // null/undefined fields are dropped (an absent param is unset on the resolver).
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") query[key] = value;
    else if (typeof value === "number") query[key] = String(value);
  }
  return query;
}

/**
 * Build a `ClientMediaSource` from its spec, binding the one media read endpoint
 * (`GET /api/media/sources/:sourceId`). The cursor rides as a query param when
 * present; the resolver decodes only the opaque outer cursor and re-parses the
 * source params off the query (design §A3).
 */
export function defineMediaSource<P extends object>(
  spec: MediaSourceSpec<P>,
): ClientMediaSource<P> {
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
