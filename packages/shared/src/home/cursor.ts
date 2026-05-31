/**
 * Isomorphic base64url JSON cursor encoder used by every home-feed row
 * provider on the server. Wire format is shared so server decode + client
 * encode agree on the byte string.
 *
 * The base64url helper is consumed from the unified media codec
 * (`../media/cursor`) so there is one copy in the shared package, not a fork.
 * Decoding stays server-side (`apps/server/src/home/cursor.ts`) because it
 * couples to zod schemas + HttpError, neither of which belong in shared.
 */

import { utf8ToBase64Url } from "../media/cursor";

export function encodeCursor(payload: unknown): string {
  return utf8ToBase64Url(JSON.stringify(payload));
}
