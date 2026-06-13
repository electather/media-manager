import type { LibraryItem } from "@nama/plugin-sdk";

// Stable client identity used on every Plex API call. Plex ties PIN approval to
// the clientIdentifier that created it, so the value MUST be deterministic
// across `startAuth` and `pollAuth` within the same deployment — otherwise the
// token Plex issues cannot be used by other callers. Versioning the identifier
// lets us rotate (e.g. on a breaking change to how we format the product name)
// without stranding existing connections.
export const PLEX_CLIENT_IDENTIFIER = "nama-v1";
export const PLEX_PRODUCT = "Nama";
export const PLEX_DEVICE = "Nama";
// Single source for both the `X-Plex-Version` request header (Plex admin UIs
// attribute sessions by this value) and the manifest's `version` field, so
// bumping the plugin version does not leave the header behind.
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
