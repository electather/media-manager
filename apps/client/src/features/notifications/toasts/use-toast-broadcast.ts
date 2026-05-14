import { useEffect, useMemo, useRef } from "react";
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
  const idsRef = useRef<Map<string, number> | null>(null);
  idsRef.current ??= new Map();
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    channelRef.current = ch;
    ch.onmessage = (e: MessageEvent<ToastedMessage>) => {
      if (e.data?.kind === "toasted") idsRef.current!.set(e.data.id, e.data.at);
    };
    return () => {
      ch.close();
      channelRef.current = null;
    };
  }, []);

  return useMemo<ToastBroadcast>(() => {
    const ids = () => idsRef.current!;

    const sweepExpired = (now: number): void => {
      const map = ids();
      for (const [k, t] of map) {
        if (now - t > BROADCAST_WINDOW_MS) map.delete(k);
      }
    };

    return {
      has(id) {
        const now = Date.now();
        const at = ids().get(id);
        if (at === undefined) return false;
        if (now - at > BROADCAST_WINDOW_MS) {
          // Sweep on read so a listener-only tab (never publishes) doesn't grow
          // the map unbounded as cross-tab announcements accumulate.
          sweepExpired(now);
          return false;
        }
        return true;
      },
      publish(id) {
        const at = Date.now();
        sweepExpired(at);
        ids().set(id, at);
        channelRef.current?.postMessage({ kind: "toasted", id, at } satisfies ToastedMessage);
      },
    };
  }, []);
}
