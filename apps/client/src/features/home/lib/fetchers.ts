import type { HomeLayoutResponse, MediaDetailsResponse } from "@nama/shared/home";
import { api } from "@/shared/lib/api";
import { throwOnError } from "@/shared/media/error";

export async function fetchHomeLayout(): Promise<HomeLayoutResponse> {
  const res = await api.home.layout.$get({ query: {} });
  if (!res.ok) await throwOnError(res);
  return (await res.json()) as HomeLayoutResponse;
}

/** Routes through shared media title resource; payload is byte-identical to legacy `/home/details`. */
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
