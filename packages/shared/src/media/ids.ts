/**
 * Pulls a TMDB id from a heterogeneous media payload. Plugins surface the
 * cross-service ids differently, so media adapters share one best-effort
 * probe order.
 */
// fallow-ignore-next-line complexity
export function extractTmdbId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const ids = v.ids as Record<string, unknown> | undefined;
  if (ids && typeof ids.tmdb === "string") return ids.tmdb;
  if (ids && typeof ids.tmdb_id === "string") return ids.tmdb_id;
  if (typeof v.tmdbId === "string") return v.tmdbId;
  return null;
}
