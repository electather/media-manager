import { WATCHLIST_LIST_DEFAULT_LIMIT, WATCHLIST_LIST_MAX_LIMIT } from "@ent-mcp/shared/watchlist";

export function clampLimit(value: number | undefined): number {
  if (value == null) return WATCHLIST_LIST_DEFAULT_LIMIT;
  if (value <= 0) return WATCHLIST_LIST_DEFAULT_LIMIT;
  return Math.min(value, WATCHLIST_LIST_MAX_LIMIT);
}

export function encodeOffsetCursor(offset: number): string {
  return Buffer.from(`offset:${offset}`, "utf8").toString("base64url");
}

// fallow-ignore-next-line complexity
export function decodeOffsetCursor(raw: string): number | null {
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    if (!decoded.startsWith("offset:")) return null;
    const n = Number(decoded.slice("offset:".length));
    return Number.isInteger(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}
