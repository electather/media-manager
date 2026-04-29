// Mutation surface placeholder. Concrete RPC endpoints
// (media.markWatched, media.addToWatchlist, etc.) ship with the
// follow-up that wires server endpoints + TanStack DB optimistic flow.
// Importers should treat this module as the future single bridge.

export type MediaMutation =
  | "markWatched"
  | "markUnwatched"
  | "addToWatchlist"
  | "removeFromWatchlist"
  | "requestAvailable";
