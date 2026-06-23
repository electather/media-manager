import type { LibraryItem } from "@nama/plugin-sdk";

// Stable client identity across startAuth and pollAuth within same deployment — MUST be
// deterministic or token Plex issues cannot be used by other callers. Versioning lets us rotate
// (e.g. breaking product-name change) without stranding existing connections.
export const PLEX_CLIENT_IDENTIFIER = "nama-v1";
export const PLEX_PRODUCT = "Nama";
export const PLEX_DEVICE = "Nama";
// Single source for X-Plex-Version header and manifest version field — bumping
// plugin version keeps both in sync (Plex admin UIs attribute sessions by header).
export const PLEX_VERSION = "1.0.0";
export const PLEX_PLATFORM = "Web";

export const PLEX_TV_BASE = "https://plex.tv/api/v2";

export const RESOLUTION_MAP: Record<string, LibraryItem["quality"]["resolution"]> = {
  "4k": "4k",
  "2160": "4k",
  "1080": "1080p",
  "720": "720p",
  "480": "sd",
  sd: "sd",
};
