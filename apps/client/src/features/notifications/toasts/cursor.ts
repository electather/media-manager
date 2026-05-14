import type { RefObject } from "react";
import { fetchInboxPage } from "../shared/fetchers";
import type { NotificationItemDto } from "../shared/types";

// Cursor format mirrors the server's keyset: base64url(<createdAt_ms>|<id>).
function encodeCursor(createdAt: number, id: string): string {
  const raw = `${createdAt}|${id}`;
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export function advanceCursor(ref: RefObject<string | null>, items: NotificationItemDto[]): void {
  if (items.length === 0) return;
  // Items from ?after are ASC (oldest→newest). Last item is the newest.
  const newest = items[items.length - 1]!;
  ref.current = encodeCursor(newest.createdAt, newest.id);
}

export async function seedCursor(ref: RefObject<string | null>): Promise<void> {
  try {
    const page = await fetchInboxPage({}, null, 1);
    const newest = page.items[0];
    if (newest) ref.current = encodeCursor(newest.createdAt, newest.id);
  } catch {
    // Seed failure is non-fatal; cursor stays null and next poll retries.
  }
}

export async function fetchNewestUnread(
  ref: RefObject<string | null>,
): Promise<NotificationItemDto | null> {
  try {
    const page = await fetchInboxPage({ unreadOnly: true }, null, 1);
    const newest = page.items[0];
    if (!newest) return null;
    ref.current = encodeCursor(newest.createdAt, newest.id);
    return newest;
  } catch {
    // Non-fatal; cursor stays null and next poll retries.
    return null;
  }
}
