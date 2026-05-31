import type { HomeLayoutResponse, MediaDetailsResponse } from "@ent-mcp/shared/home";
import { api } from "@/shared/lib/api";
import { throwOnError } from "@/shared/media/error";

export async function fetchHomeLayout(): Promise<HomeLayoutResponse> {
  const res = await api.home.layout.$get({ query: {} });
  if (!res.ok) await throwOnError(res);
  return (await res.json()) as HomeLayoutResponse;
}

/**
 * Detail-modal read. Routes through the shared media title resource
 * (`GET /api/media/:type/:tmdbId/details`, design §A2/§B3) — a one-line bridge
 * to the same `home.composeDetails` the old `/home/details` endpoint called, so
 * the payload (`{ summary, details }`) is byte-identical.
 */
export async function fetchHomeDetails(
  tmdbId: string,
  mediaType: "movie" | "tv",
): Promise<MediaDetailsResponse> {
  const res = await api.media[":type"][":tmdbId"].details.$get({
    param: { type: mediaType, tmdbId },
  });
  if (!res.ok) await throwOnError(res);
  return (await res.json()) as MediaDetailsResponse;
}
