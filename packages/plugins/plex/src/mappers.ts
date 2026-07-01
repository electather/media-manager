import type { LibraryItem } from "@nama/plugin-sdk";
import type { PlexUserCfg, PlexMetadata, PlexGuid } from "./types";
import { RESOLUTION_MAP } from "./constants";
import { externalBase } from "./client";

export function mapResolution(raw: string | undefined): LibraryItem["quality"]["resolution"] {
  if (!raw) return undefined;
  const key = raw.toLowerCase();
  return RESOLUTION_MAP[key] ?? undefined;
}

export function mapHdr(raw: string | undefined): LibraryItem["quality"]["hdr"] {
  if (!raw) return undefined;
  const key = raw.toLowerCase();
  if (key.includes("dolby")) return "dolby-vision";
  if (key.includes("hdr10")) return "hdr10";
  if (key.includes("hlg")) return "hlg";
  if (key === "sdr") return "none";
  return undefined;
}

export function itemType(raw: string): LibraryItem["type"] {
  if (raw === "movie") return "movie";
  if (raw === "episode") return "episode";
  return "show";
}

export function buildPlayerLink(cfg: PlexUserCfg, ratingKey: string): string {
  // Plex's cross-client deep-link format. Encodes the server and item so the
  // caller's native app opens the right thing without a round-trip through
  // plex.tv. The server URL MUST be the external one.
  const server = encodeURIComponent(externalBase(cfg));
  return `plex://preplay/?metadataKey=%2Flibrary%2Fmetadata%2F${ratingKey}&server=${server}`;
}

export function buildWebLink(cfg: PlexUserCfg, ratingKey: string): string {
  const base = externalBase(cfg);
  const metadataKey = encodeURIComponent(`/library/metadata/${ratingKey}`);
  // `machineIdentifier` is a Plex-assigned hex string in practice; wrap in
  // `encodeURIComponent` as defence-in-depth in case a future server form
  // starts returning values that include URL-reserved characters.
  return `${base}/web/index.html#!/server/${encodeURIComponent(cfg.machineIdentifier)}/details?key=${metadataKey}`;
}

export function parseGuids(guids: PlexGuid[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const g of guids ?? []) {
    const m = /^(tmdb|imdb|tvdb):\/\/(.+)$/.exec(g.id);
    if (!m) continue;
    out[m[1]!] = m[2]!;
  }
  return out;
}

export function toLibraryItem(cfg: PlexUserCfg, m: PlexMetadata): LibraryItem {
  const firstMedia = m.Media?.[0];
  const firstPart = firstMedia?.Part?.[0];
  const quality = {
    resolution: mapResolution(firstMedia?.videoResolution),
    codec: firstMedia?.videoCodec,
    hdr: mapHdr(firstMedia?.videoDynamicRange),
    bitrate: firstMedia?.bitrate,
  };
  // Carry Plex's parsed `Guid` entries (tmdb/imdb/tvdb) plus the server-local
  // ratingKey on `ids` so the host can re-key this title against TMDB without
  // a follow-up `idResolve@v1` round-trip.
  const ids: Record<string, string> = parseGuids(m.Guid);
  ids["plex:ratingKey"] = m.ratingKey;
  return {
    id: m.ratingKey,
    title: m.type === "episode" ? (m.grandparentTitle ?? m.title) : m.title,
    type: itemType(m.type),
    season: m.parentIndex,
    episode: m.index,
    quality,
    playerLink: buildPlayerLink(cfg, m.ratingKey),
    webLink: buildWebLink(cfg, m.ratingKey),
    sizeBytes: firstPart?.size,
    durationSec: m.duration ? Math.round(m.duration / 1000) : undefined,
    // `LibraryItem.addedAt` is required by the capability schema, so falling
    // back to the Unix epoch when Plex does not send `addedAt` keeps the item
    // schema-valid. Callers sorting by `addedAt` see all unknown-timestamp
    // items cluster at the start of time — this is deliberately surprising
    // so the gap is visible rather than silent.
    addedAt: m.addedAt ? new Date(m.addedAt * 1000).toISOString() : new Date(0).toISOString(),
    ids,
  };
}

/**
 * Maps to `MediaItem` (playback@v1, watchHistory@v1). Unlike `toLibraryItem`,
 * uses cross-service shape. `cfg` kept for future poster-URL enrichment
 * without rethreading callsites.
 */
export function toItemShape(
  _cfg: PlexUserCfg,
  m: PlexMetadata,
): {
  id: string;
  title: string;
  year: number | null;
  type: "movie" | "tv";
  genres: string[];
  rating: number | null;
  overview: string;
  posterUrl: string | null;
  ids: Record<string, string>;
} {
  const guids = parseGuids(m.Guid);
  const ids: Record<string, string> = { plex_ratingKey: m.ratingKey };
  if (guids["tmdb"]) ids["tmdb_id"] = guids["tmdb"]!;
  if (guids["imdb"]) ids["imdb_id"] = guids["imdb"]!;
  if (guids["tvdb"]) ids["tvdb_id"] = guids["tvdb"]!;
  // Collapse Plex-local types to the cross-service catalog types: "show" and
  // "episode" both render as "tv"; "movie" stays as-is.
  const castType: "movie" | "tv" = m.type === "movie" ? "movie" : "tv";
  return {
    id: `${castType}:${guids["tmdb"] ?? m.ratingKey}`,
    title: m.type === "episode" ? (m.grandparentTitle ?? m.title) : m.title,
    year: null,
    type: castType,
    genres: [],
    rating: null,
    overview: "",
    posterUrl: null,
    ids,
  };
}

export function normalizeSessionState(raw: string | undefined): "playing" | "paused" | "buffering" {
  if (raw === "paused") return "paused";
  if (raw === "buffering") return "buffering";
  return "playing";
}

export function normalizeDecision(raw: string | undefined): "direct-play" | "copy" | "transcode" {
  if (raw === "copy") return "copy";
  if (raw === "transcode") return "transcode";
  return "direct-play";
}

/**
 * Extracts Plex ratingKey: prefers `ids.plex_ratingKey`, falls back to `id` if
 * all digits. Returns null for cross-service IDs; route through `idResolve` first
 * (#29 for host wiring).
 */
export function extractRatingKey(item: {
  id?: string;
  ids?: { plex_ratingKey?: string };
}): string | null {
  if (item.ids?.plex_ratingKey) return item.ids.plex_ratingKey;
  if (item.id && /^\d+$/.test(item.id)) return item.id;
  return null;
}
