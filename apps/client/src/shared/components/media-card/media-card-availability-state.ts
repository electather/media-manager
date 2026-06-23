import type { Availability, Facets } from "@nama/shared/home";

export type MediaCardAvailabilityKind = "server" | "request" | "requested" | "upcoming" | "info";

export interface MediaCardAvailabilityState {
  kind: MediaCardAvailabilityKind;
  serverLabel: string | null;
  serverCount: number;
  serverPicker: boolean;
}

export interface MediaCardAvailabilityInput {
  availability?: Availability;
  status?: "available" | "requested" | "processing" | "unavailable" | "unknown";
  facets?: Facets;
}

function empty(kind: MediaCardAvailabilityKind): MediaCardAvailabilityState {
  return { kind, serverLabel: null, serverCount: 0, serverPicker: false };
}

/**
 * Derives visibility badge from availability + status. Order: server-copy → requested
 * → upcoming (release date wins over request-eligible) → request → info.
 */
export function deriveMediaCardAvailability(
  input: MediaCardAvailabilityInput,
): MediaCardAvailabilityState {
  const a = input.availability;
  const servers = a?.servers ?? [];

  if (a?.hasAnyServerCopy) {
    if (servers.length === 1)
      return {
        kind: "server",
        serverLabel: servers[0]!.label,
        serverCount: 1,
        serverPicker: false,
      };
    if (servers.length > 1)
      return {
        kind: "server",
        serverLabel: null,
        serverCount: servers.length,
        serverPicker: true,
      };
    return { kind: "server", serverLabel: null, serverCount: 0, serverPicker: false };
  }

  if (input.status === "requested") return empty("requested");
  if (input.facets?.releaseDate) return empty("upcoming");
  if (a?.requestEligible) return empty("request");
  return empty("info");
}
