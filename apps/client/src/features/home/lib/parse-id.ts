export function parseCompactId(id: string): { mediaType: "movie" | "tv"; tmdbId: string } | null {
  const idx = id.indexOf(":");
  if (idx <= 0) return null;
  const head = id.slice(0, idx);
  const tail = id.slice(idx + 1);
  if (head !== "movie" && head !== "tv") return null;
  if (tail.length === 0) return null;
  return { mediaType: head, tmdbId: tail };
}
