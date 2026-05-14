import { useEffect, useEffectEvent, useRef } from "react";
import type { RefObject } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useUnreadCount } from "../bell/use-unread-count";
import { useMarkRead } from "../inbox/use-inbox-mutations";
import { fetchInboxAfter } from "../shared/fetchers";
import type { NotificationItemDto } from "../shared/types";
import { advanceCursor, fetchNewestUnread, seedCursor } from "./cursor";
import { isToastable } from "./is-toastable";
import { MAX_TOASTS_PER_CYCLE } from "./constants";
import { renderClusterToast, renderToast, type ToastDeps } from "./toast-renderer";
import { useToastBroadcast } from "./use-toast-broadcast";

async function collectFresh(
  cursor: string,
  cursorRef: RefObject<string | null>,
  deps: ToastDeps,
): Promise<NotificationItemDto[]> {
  const fresh: NotificationItemDto[] = [];
  let nextCursor: string | undefined = cursor;
  // Drain all pages so bursts larger than the per-page limit are never silently dropped.
  while (nextCursor !== undefined) {
    const page = await fetchInboxAfter(nextCursor, { unreadOnly: true, limit: 10 });
    advanceCursor(cursorRef, page.items);
    for (const item of page.items) {
      if (!deps.broadcast.has(item.id) && isToastable(item)) fresh.push(item);
    }
    nextCursor = page.nextCursor;
  }
  return fresh;
}

function renderCapped(fresh: NotificationItemDto[], deps: ToastDeps): void {
  if (fresh.length === 0) return;
  const capped = fresh.slice(0, MAX_TOASTS_PER_CYCLE);
  for (const item of capped) renderToast(item, deps);
  const overflow = fresh.length - capped.length;
  if (overflow > 0) renderClusterToast(overflow, deps);
}

async function handleDelta(cursorRef: RefObject<string | null>, deps: ToastDeps): Promise<void> {
  const cursor = cursorRef.current;
  if (!cursor) {
    // Cursor null: seed failed at boot, or count was 0 when seeded.
    // Fetch newest unread, seed cursor, and toast in one pass.
    const newest = await fetchNewestUnread(cursorRef);
    if (newest && !deps.broadcast.has(newest.id) && isToastable(newest)) {
      renderToast(newest, deps);
    }
    return;
  }
  const fresh = await collectFresh(cursor, cursorRef, deps);
  renderCapped(fresh, deps);
}

interface DrainState {
  drainingRef: RefObject<boolean>;
  pendingCountRef: RefObject<number | null>;
  cursorRef: RefObject<string | null>;
  deps: ToastDeps;
}

async function runDrain(count: number, state: DrainState): Promise<void> {
  if (state.drainingRef.current) {
    state.pendingCountRef.current = count;
    return;
  }
  state.drainingRef.current = true;
  try {
    await handleDelta(state.cursorRef, state.deps);
    while (state.pendingCountRef.current !== null) {
      state.pendingCountRef.current = null;
      await handleDelta(state.cursorRef, state.deps);
    }
  } finally {
    state.drainingRef.current = false;
  }
}

export function useNotificationToaster(): void {
  const { data: countResult } = useUnreadCount();
  const prevCountRef = useRef<number | null>(null);
  const lastSeenCursorRef = useRef<string | null>(null);
  // Single-flight guard. Concurrent deltas firing while a previous drain is
  // still in flight would share `lastSeenCursorRef` and could double-render an
  // item before its `broadcast.publish` lands. We instead drain serially and
  // remember the highest pending count so we re-run once the in-flight pass
  // finishes (covers bursts that arrive mid-drain).
  const drainingRef = useRef(false);
  const pendingCountRef = useRef<number | null>(null);
  const broadcast = useToastBroadcast();
  const navigate = useNavigate();
  const markReadMutation = useMarkRead();

  const onCountChange = useEffectEvent((count: number, prev: number | null) => {
    if (prev === null) {
      void seedCursor(lastSeenCursorRef);
      return;
    }
    if (count <= prev) return;
    void runDrain(count, {
      drainingRef,
      pendingCountRef,
      cursorRef: lastSeenCursorRef,
      deps: { navigate, markReadMutation, broadcast },
    });
  });

  useEffect(() => {
    const count = countResult ? countResult.count : 0;
    const prev = prevCountRef.current;
    prevCountRef.current = count;
    onCountChange(count, prev);
  }, [countResult?.count]);
}
