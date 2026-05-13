import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { MutableRefObject } from "react";
import { useUnreadCount } from "../bell/use-unread-count";
import { useMarkRead } from "../inbox/use-inbox-mutations";
import { fetchInboxPage } from "../shared/fetchers";
import type { NotificationItemDto } from "../shared/types";
import { fetchInboxAfter } from "./fetch-inbox-after";
import { isToastable } from "./is-toastable";
import { MAX_TOASTS_PER_CYCLE } from "./constants";
import { renderClusterToast, renderToast, type ToastDeps } from "./toast-renderer";
import { useToastBroadcast } from "./use-toast-broadcast";

// Cursor format mirrors the server's keyset: base64url(<createdAt_ms>|<id>).
function encodeCursor(createdAt: number, id: string): string {
  const raw = `${createdAt}|${id}`;
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function advanceCursor(ref: MutableRefObject<string | null>, items: NotificationItemDto[]): void {
  if (items.length === 0) return;
  // Items from ?after are ASC (oldest→newest). Last item is the newest.
  const newest = items[items.length - 1]!;
  ref.current = encodeCursor(newest.createdAt, newest.id);
}

async function seedCursor(ref: MutableRefObject<string | null>): Promise<void> {
  try {
    const page = await fetchInboxPage({}, null, 1);
    const newest = page.items[0];
    if (newest) ref.current = encodeCursor(newest.createdAt, newest.id);
  } catch {
    // Seed failure is non-fatal; cursor stays null and next poll retries.
  }
}

// Called when a delta is detected but cursor is null (seed failed at boot, or
// count was 0 when seeded). Fetches the single newest unread item, seeds the
// cursor, and toasts it — all in one pass so the item is never missed.
async function seedAndToast(ref: MutableRefObject<string | null>, deps: ToastDeps): Promise<void> {
  try {
    const page = await fetchInboxPage({ unreadOnly: true }, null, 1);
    const newest = page.items[0];
    if (!newest) return;
    ref.current = encodeCursor(newest.createdAt, newest.id);
    if (!deps.broadcast.has(newest.id) && isToastable(newest)) {
      renderToast(newest, deps);
    }
  } catch {
    // Non-fatal; cursor stays null and next poll retries.
  }
}

async function renderFreshItems(
  cursor: string,
  cursorRef: MutableRefObject<string | null>,
  deps: ToastDeps,
): Promise<void> {
  const page = await fetchInboxAfter(cursor, { unreadOnly: true, limit: 10 });
  const fresh = page.items.filter((i) => !deps.broadcast.has(i.id) && isToastable(i));
  advanceCursor(cursorRef, page.items);
  if (fresh.length === 0) return;
  const capped = fresh.slice(0, MAX_TOASTS_PER_CYCLE);
  for (const item of capped) renderToast(item, deps);
  const overflow = fresh.length - capped.length;
  if (overflow > 0) renderClusterToast(overflow, deps);
}

async function handleDelta(
  cursorRef: MutableRefObject<string | null>,
  deps: ToastDeps,
): Promise<void> {
  const cursor = cursorRef.current;
  if (!cursor) {
    // Cursor null: seed failed at boot, or count was 0 when seeded.
    // Fetch newest unread, seed cursor, and toast in one pass.
    await seedAndToast(cursorRef, deps);
    return;
  }
  await renderFreshItems(cursor, cursorRef, deps);
}

export function useNotificationToaster(): void {
  const { data: countResult } = useUnreadCount();
  const prevCountRef = useRef<number | null>(null);
  const lastSeenCursorRef = useRef<string | null>(null);
  const broadcast = useToastBroadcast();
  const navigate = useNavigate();
  const markReadMutation = useMarkRead();

  // Stash mutable deps in refs so the effect closure always reads the latest
  // values without listing them as deps (avoids stale-closure trap on React 19).
  const navigateRef = useRef(navigate);
  const markReadMutationRef = useRef(markReadMutation);
  const broadcastRef = useRef(broadcast);
  navigateRef.current = navigate;
  markReadMutationRef.current = markReadMutation;
  broadcastRef.current = broadcast;

  useEffect(() => {
    const count = countResult ? countResult.count : 0;
    const prev = prevCountRef.current;
    prevCountRef.current = count;

    // First observation: seed cursor from newest item, fire no toasts.
    if (prev === null) {
      void seedCursor(lastSeenCursorRef);
      return;
    }
    if (count <= prev) return;

    void handleDelta(lastSeenCursorRef, {
      navigate: navigateRef.current,
      markReadMutation: markReadMutationRef.current,
      broadcast: broadcastRef.current,
    });
  }, [countResult?.count]);
}
