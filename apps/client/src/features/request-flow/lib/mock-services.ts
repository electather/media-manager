import type { RequestService, UserRole } from "./types";

// Mock plugin / service catalog. Replace with the real plugin registry
// when the request endpoint is wired.
export const SERVICES: RequestService[] = [
  {
    id: "home-server",
    label: "Radarr · Main",
    sub: "Movies · custom profiles",
    glyph: "server",
    exposesProfiles: true,
    supports: ["movie"],
    profiles: [
      { id: "best", label: "Best available", detail: "4K HDR · Atmos" },
      { id: "remux", label: "Remux preferred", detail: "High bitrate" },
      { id: "1080", label: "Standard 1080p", detail: "Wide compat" },
      { id: "thin", label: "Bandwidth-friendly", detail: "720p · 2 Mbps" },
    ],
    defaultProfileId: "best",
  },
  {
    id: "cloud-library",
    label: "Radarr · 4K",
    sub: "Movies · premium library",
    glyph: "stack",
    exposesProfiles: true,
    supports: ["movie"],
    profiles: [
      { id: "uhd", label: "UHD only", detail: "2160p ceiling" },
      { id: "hdr", label: "HDR preferred", detail: "HDR/DV first" },
    ],
    defaultProfileId: "uhd",
  },
  {
    id: "sonarr-main",
    label: "Sonarr · Main",
    sub: "TV · standard library",
    glyph: "server",
    exposesProfiles: true,
    supports: ["tv"],
    profiles: [
      { id: "best", label: "Best available", detail: "HD/4K as configured" },
      { id: "1080", label: "HD episodes", detail: "1080p ceiling" },
      { id: "daily", label: "Quick grab", detail: "Fastest acceptable" },
    ],
    defaultProfileId: "best",
  },
  {
    id: "sonarr-anime",
    label: "Sonarr · Anime",
    sub: "TV · separate rules",
    glyph: "stack",
    exposesProfiles: true,
    supports: ["tv"],
    profiles: [
      { id: "sub", label: "Sub preferred", detail: "Custom format score" },
      { id: "dual", label: "Dual audio", detail: "Language profile" },
    ],
    defaultProfileId: "sub",
  },
];

export const ROLES: Record<UserRole, { needsApproval: boolean }> = {
  user: { needsApproval: true },
  admin: { needsApproval: false },
};

// Default destination per kind. Used when consumers don't supply their own.
export const DEFAULT_MOVIE_SERVICE_ID = "home-server";
export const DEFAULT_MOVIE_PROFILE_ID = "best";
export const DEFAULT_TV_SERVICE_ID = "sonarr-main";
export const DEFAULT_TV_PROFILE_ID = "best";
