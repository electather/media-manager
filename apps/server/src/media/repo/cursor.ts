export interface PageCursor {
  addedAt: number;
  id: string;
}

/**
 * Encode/decode are url-safe + opaque so clients pass the cursor through
 * verbatim. Base64 of `${addedAt}:${id}` — id is a cuid, so no `:` in either
 * component.
 */
export function encodeCursor(cursor: PageCursor): string {
  return Buffer.from(`${cursor.addedAt}:${cursor.id}`, "utf8").toString("base64url");
}

// fallow-ignore-next-line complexity
export function decodeCursor(raw: string): PageCursor | null {
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const idx = decoded.indexOf(":");
    if (idx <= 0) return null;
    const addedAt = Number(decoded.slice(0, idx));
    const id = decoded.slice(idx + 1);
    if (!Number.isFinite(addedAt) || id.length === 0) return null;
    return { addedAt, id };
  } catch {
    return null;
  }
}
