import { invalidId } from "./errors";

export interface ParsedMediaId {
  type: "movie" | "tv";
  tmdbId: string;
}

/**
 * Canonical MCP media-id format: `{type}:{tmdb_id}` (e.g. `movie:550`, `tv:1396`).
 * Throws `McpError(mcp.invalid_id)` for anything that doesn't match.
 */
// fallow-ignore-next-line complexity
export function parseMediaId(raw: string): ParsedMediaId {
  if (typeof raw !== "string") throw invalidId(String(raw));
  const parts = raw.split(":");
  if (parts.length !== 2) throw invalidId(raw);
  const [type, tmdbId] = parts;
  if ((type !== "movie" && type !== "tv") || !tmdbId || !/^[0-9]+$/.test(tmdbId)) {
    throw invalidId(raw);
  }
  return { type, tmdbId };
}

export function formatMediaId(type: "movie" | "tv", tmdbId: string): string {
  return `${type}:${tmdbId}`;
}
