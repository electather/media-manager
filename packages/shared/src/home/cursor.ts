/**
 * Isomorphic base64url JSON cursor encoder (wire format shared across server/client).
 * Reuses unified media codec (../media/cursor) for one copy in shared.
 * Decoding server-only (apps/server/src/home/cursor.ts) — couples to zod + HttpError.
 */

import { utf8ToBase64Url } from "../media/cursor";

export function encodeCursor(payload: unknown): string {
  return utf8ToBase64Url(JSON.stringify(payload));
}
