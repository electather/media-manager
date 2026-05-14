import { useEffect, useRef } from "react";
import { BROADCAST_CHANNEL_NAME, BROADCAST_WINDOW_MS } from "./constants";

interface ToastedMessage {
  kind: "toasted";
  id: string;
  at: number;
}

export interface ToastBroadcast {
  has: (id: string) => boolean;
  publish: (id: string) => void;
}

export function useToastBroadcast(): ToastBroadcast {
  const ids = useRef<Map<string, number>>(new Map());
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    channelRef.current = ch;
    ch.onmessage = (e: MessageEvent<ToastedMessage>) => {
      if (e.data?.kind === "toasted") ids.current.set(e.data.id, e.data.at);
    };
    return () => {
      ch.close();
      channelRef.current = null;
    };
  }, []);

  function sweepExpired(now: number): void {
    for (const [k, t] of ids.current) {
      if (now - t > BROADCAST_WINDOW_MS) ids.current.delete(k);
    }
  }

  function has(id: string): boolean {
    const now = Date.now();
    const at = ids.current.get(id);
    if (at === undefined) return false;
    if (now - at > BROADCAST_WINDOW_MS) {
      // Sweep on read so a listener-only tab (never publishes) doesn't grow
      // the map unbounded as cross-tab announcements accumulate.
      sweepExpired(now);
      return false;
    }
    return true;
  }

  function publish(id: string): void {
    const at = Date.now();
    sweepExpired(at);
    ids.current.set(id, at);
    channelRef.current?.postMessage({ kind: "toasted", id, at } satisfies ToastedMessage);
  }

  return { has, publish };
}
