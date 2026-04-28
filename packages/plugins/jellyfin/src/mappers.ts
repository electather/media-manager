import type { LibraryItem } from "@ent-mcp/plugin-sdk";
import { pluginError } from "@ent-mcp/plugin-sdk";
import type { JellyfinItem, JellyfinProviderIds, MediaItemShape } from "./types";
import { TICKS_PER_SECOND } from "./constants";

export function ticksToMs(ticks: number | undefined): number {
  return Math.floor((ticks ?? 0) / 10_000);
}

export function ticksToSeconds(ticks: number | undefined): number | undefined {
  if (!ticks) return undefined;
  return Math.floor(ticks / TICKS_PER_SECOND);
}

export function mapItemType(jfType: string): "movie" | "show" | "episode" | null {
  switch (jfType) {
    case "Movie":
      return "movie";
    case "Series":
      return "show";
    case "Episode":
      return "episode";
    default:
      return null;
  }
}

export function mapPlaybackType(jfType: string): "movie" | "tv" | null {
  if (jfType === "Movie") return "movie";
  if (jfType === "Episode") return "tv";
  return null;
}

export function mapHdr(
  range: string | undefined,
  rangeType: string | undefined,
): "hdr10" | "dolby-vision" | "hlg" | "none" | undefined {
  const rt = rangeType?.toLowerCase() ?? "";
  if (rt.includes("dovi") || rt.includes("dolby")) return "dolby-vision";
  if (rt === "hdr10" || rt === "hdr10plus" || rt === "hdr") return "hdr10";
  if (rt === "hlg") return "hlg";
  if ((range ?? "").toLowerCase() === "hdr") return "hdr10";
  return "none";
}

export function mapResolution(
  width: number | undefined,
  height: number | undefined,
): "4k" | "1080p" | "720p" | "sd" | undefined {
  const h = height ?? 0;
  const w = width ?? 0;
  if (h >= 2000 || w >= 3000) return "4k";
  if (h >= 1000) return "1080p";
  if (h >= 700) return "720p";
  if (h > 0) return "sd";
  return undefined;
}

export function buildItemUrl(externalBase: string, itemId: string): string {
  return `${externalBase}/web/index.html#!/details?id=${encodeURIComponent(itemId)}`;
}

export function mapQuality(item: JellyfinItem): LibraryItem["quality"] {
  const videoStream = item.MediaSources?.[0]?.MediaStreams?.find((s) => s.Type === "Video");
  const source = item.MediaSources?.[0];
  const quality: LibraryItem["quality"] = {};
  const resolution = mapResolution(videoStream?.Width, videoStream?.Height);
  if (resolution) quality.resolution = resolution;
  if (videoStream?.Codec) quality.codec = videoStream.Codec;
  const hdr = mapHdr(videoStream?.VideoRange, videoStream?.VideoRangeType);
  if (hdr) quality.hdr = hdr;
  if (source?.Bitrate) quality.bitrate = Math.round(source.Bitrate / 1000);
  return quality;
}

export function mapLibraryItem(item: JellyfinItem, externalBase: string): LibraryItem | null {
  const type = mapItemType(item.Type);
  if (!type) return null;
  const entry: LibraryItem = {
    id: item.Id,
    title: item.Name,
    type,
    quality: mapQuality(item),
    playerLink: buildItemUrl(externalBase, item.Id),
    webLink: buildItemUrl(externalBase, item.Id),
    addedAt: item.DateCreated ?? new Date(0).toISOString(),
  };
  if (type === "episode") {
    if (typeof item.ParentIndexNumber === "number") entry.season = item.ParentIndexNumber;
    if (typeof item.IndexNumber === "number") entry.episode = item.IndexNumber;
  }
  const size = item.MediaSources?.[0]?.Size;
  if (typeof size === "number") entry.sizeBytes = size;
  const durationSec = ticksToSeconds(item.RunTimeTicks);
  if (durationSec) entry.durationSec = durationSec;
  return entry;
}

export function mapMediaShape(row: JellyfinItem): MediaItemShape | null {
  const type = mapPlaybackType(row.Type);
  if (!type) return null;
  return {
    id: `jellyfin:${row.Id}`,
    title: row.Name,
    year: row.ProductionYear ?? null,
    type,
    genres: [],
    rating: null,
    overview: "",
    posterUrl: null,
    ids: {
      tmdb_id: row.ProviderIds?.Tmdb,
      imdb_id: row.ProviderIds?.Imdb,
      tvdb_id: row.ProviderIds?.Tvdb,
    },
  };
}

export function extractIds(
  providers: JellyfinProviderIds | undefined,
  itemId: string,
): Record<string, string> {
  const out: Record<string, string | undefined> = {
    tmdb: providers?.Tmdb,
    imdb: providers?.Imdb,
    tvdb: providers?.Tvdb,
    "jellyfin:itemId": itemId,
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as Record<
    string,
    string
  >;
}

export function toJfProvider(id: "tmdb" | "imdb" | "tvdb"): "Tmdb" | "Imdb" | "Tvdb" {
  if (id === "tmdb") return "Tmdb";
  if (id === "imdb") return "Imdb";
  return "Tvdb";
}

export function requireJellyfinItemIds(
  items: Array<{ ids?: { "jellyfin:itemId"?: string } }>,
  methodName: string,
): string[] {
  return items.map((it) => {
    const itemId = it.ids?.["jellyfin:itemId"];
    if (!itemId) {
      throw pluginError(
        "plugin.input_invalid",
        `Jellyfin.${methodName} requires \`jellyfin:itemId\` on every item`,
      );
    }
    return itemId;
  });
}
