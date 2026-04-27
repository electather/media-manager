import type { Ctx } from "../types";
import { tmdbGet } from "../client";

function mapVideoKind(type: string): "trailer" | "teaser" | "clip" | "featurette" | "other" {
  switch (type) {
    case "Trailer":
      return "trailer";
    case "Teaser":
      return "teaser";
    case "Clip":
      return "clip";
    case "Featurette":
      return "featurette";
    default:
      return "other";
  }
}

function buildVideoUrl(site: string, key: string): string | null {
  switch (site) {
    case "YouTube":
      return `https://www.youtube.com/watch?v=${key}`;
    case "Vimeo":
      return `https://vimeo.com/${key}`;
    // Return null for unknown sites rather than the bare key — the `url`
    // schema field is nullable and consumers will treat a non-null value as a
    // real URL. The original `site` and `key` remain on the entry.
    default:
      return null;
  }
}

export const trailers = {
  async getVideos(ctx: unknown, input: unknown) {
    const c = ctx as Ctx;
    const { id, type } = input as { id: string; type: "movie" | "tv" };
    const data = (await tmdbGet(c, `/${type}/${id}/videos`)) as {
      results?: Array<{
        key: string;
        site: string;
        type: string;
        official?: boolean;
      }>;
    };
    return (data.results ?? []).map((v) => ({
      kind: mapVideoKind(v.type),
      site: v.site,
      key: v.key,
      url: buildVideoUrl(v.site, v.key),
      official: v.official,
    }));
  },
};
