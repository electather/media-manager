// UI-local types for the request flow. Wire types (`CreateMediaRequestBody`,
// `RequestTarget`, `RequestProfile`) live in `@ent-mcp/shared/media`.

/**
 * Per-episode status the request flow renders. Values map onto the four
 * status chip variants the picker expects; the request-flow feature owns
 * this vocabulary now that the home feed no longer carries seasons[].
 */
export type EpisodeStatus = "available" | "requested" | "unavailable" | "upcoming";

export type Episode = {
  id: string;
  episode: number;
  title: string;
  airDate: string;
  runtime: number;
  status: EpisodeStatus;
};

export type Season = {
  number: number;
  episodeCount: number;
  counts: Partial<Record<EpisodeStatus, number>>;
  episodes: Episode[];
};

export type RequestStatus =
  | "available"
  | "in-progress"
  | "pending"
  | "missing"
  | "partial"
  | "upcoming";

/**
 * Lightweight UI-local descriptor used by tooltips. Composed by the action
 * components from the picker selection — not a wire type.
 */
export type RequestDestination = {
  serviceLabel: string;
  profileLabel: string | null;
};
