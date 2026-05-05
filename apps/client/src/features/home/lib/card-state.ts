import type { HomeMediaItem } from "./types";

export type CardAvailabilityKind = "server" | "request" | "requested" | "upcoming" | "info";

export type CardAvailabilityState = {
  kind: CardAvailabilityKind;
  serverLabel: string | null;
  serverCount: number;
  serverPicker: boolean;
};

function empty(kind: CardAvailabilityKind): CardAvailabilityState {
  return { kind, serverLabel: null, serverCount: 0, serverPicker: false };
}

/**
 * Derives the visible availability badge from the item's availability + status.
 * Mirrors the prototype's `deriveCardState` so badge copy and tone match the
 * design without re-implementing the rule per surface.
 *
 * Order matters: server-copy first, then explicit requested status, then
 * upcoming (release date wins over request-eligible), then request, else info.
 */
export function deriveCardState(item: HomeMediaItem): CardAvailabilityState {
  const a = item.availability;
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
    // hasAnyServerCopy=true but servers[] empty — data inconsistency guard.
    return { kind: "server", serverLabel: null, serverCount: 0, serverPicker: false };
  }

  if (item.status === "requested") return empty("requested");
  if (item.facets?.releaseDate) return empty("upcoming");
  if (a?.requestEligible) return empty("request");
  return empty("info");
}
