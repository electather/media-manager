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

  function has(id: string): boolean {
    const at = ids.current.get(id);
    if (at === undefined) return false;
    return Date.now() - at <= BROADCAST_WINDOW_MS;
  }

  function publish(id: string): void {
    const at = Date.now();
    // GC entries older than BROADCAST_WINDOW_MS on publish to prevent unbounded growth.
    for (const [k, t] of ids.current) {
      if (at - t > BROADCAST_WINDOW_MS) ids.current.delete(k);
    }
    ids.current.set(id, at);
    channelRef.current?.postMessage({ kind: "toasted", id, at } satisfies ToastedMessage);
  }

  return { has, publish };
}
