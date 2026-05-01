import type { ServiceDescriptor } from "./types";

export const SERVICES: ServiceDescriptor[] = [
  {
    id: "radarr",
    label: "Radarr",
    profiles: [
      { id: "1080p", label: "1080p" },
      { id: "4k", label: "4K" },
    ],
  },
  {
    id: "sonarr",
    label: "Sonarr",
    profiles: [
      { id: "1080p", label: "1080p" },
      { id: "4k", label: "4K" },
    ],
  },
];
