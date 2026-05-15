/**
 * Isomorphic base64url JSON cursor encoder used by every home-feed row
 * provider on the server and the few clients (media-detail) that have to
 * mint a seed cursor without a round-trip. Wire format is shared so server
 * decode + client encode agree on the byte string.
 *
 * Decoding stays server-side (`apps/server/src/home/cursor.ts`) because it
 * couples to zod schemas + HttpError, neither of which belong in shared.
 */

function utf8ToBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

export function encodeCursor(payload: unknown): string {
  return utf8ToBase64Url(JSON.stringify(payload));
}
