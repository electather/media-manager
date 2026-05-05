import type { HomeMediaItem } from "./types";

export type CardAvailabilityKind = "server" | "request" | "requested" | "upcoming" | "info";

export type CardAvailabilityState = {
  kind: CardAvailabilityKind;
  serverLabel: string | null;
  serverCount: number;
  serverPicker: boolean;
};

/**
 * Derives the visible availability badge from the item's availability + status.
 * Mirrors the prototype's `deriveCardState` so badge copy and tone match the
 * design without re-implementing the rule per surface.
 */
export function deriveCardState(item: HomeMediaItem): CardAvailabilityState {
  const a = item.availability;
  const servers = a?.servers ?? [];

  if (a?.hasAnyServerCopy) {
    if (servers.length === 1)
      return { kind: "server", serverLabel: servers[0]!.label, serverCount: 1, serverPicker: false };
    if (servers.length > 1)
      return { kind: "server", serverLabel: null, serverCount: servers.length, serverPicker: true };
    return { kind: "server", serverLabel: null, serverCount: 0, serverPicker: false };
  }

  if (item.status === "requested" || (a && !a.requestEligible && !a.hasAnyServerCopy && item.status !== "unavailable"))
    return { kind: "requested", serverLabel: null, serverCount: 0, serverPicker: false };

  if (a?.requestEligible)
    return { kind: "request", serverLabel: null, serverCount: 0, serverPicker: false };

  if (item.facets?.releaseDate)
    return { kind: "upcoming", serverLabel: null, serverCount: 0, serverPicker: false };

  return { kind: "info", serverLabel: null, serverCount: 0, serverPicker: false };
}
