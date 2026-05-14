// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { BROADCAST_WINDOW_MS } from "../constants";

// BroadcastChannel mock — must be assigned before the module is imported.
class MockBroadcastChannel {
  static instances: MockBroadcastChannel[] = [];
  name: string;
  onmessage: ((e: MessageEvent) => void) | null = null;

  constructor(name: string) {
    this.name = name;
    MockBroadcastChannel.instances.push(this);
  }

  postMessage(data: unknown) {
    // Deliver to all other open instances on the same channel name.
    for (const ch of MockBroadcastChannel.instances) {
      if (ch !== this && ch.name === this.name && ch.onmessage) {
        ch.onmessage(new MessageEvent("message", { data }));
      }
    }
  }

  close() {
    MockBroadcastChannel.instances = MockBroadcastChannel.instances.filter((ch) => ch !== this);
  }
}

Object.defineProperty(globalThis, "BroadcastChannel", {
  value: MockBroadcastChannel,
  writable: true,
});

import { useToastBroadcast } from "../use-toast-broadcast";

beforeEach(() => {
  MockBroadcastChannel.instances = [];
});

afterEach(() => cleanup());

describe("useToastBroadcast", () => {
  it("publish in tab A → has returns true in tab B", () => {
    const { result: a } = renderHook(() => useToastBroadcast());
    const { result: b } = renderHook(() => useToastBroadcast());

    act(() => a.current.publish("id-1"));

    expect(b.current.has("id-1")).toBe(true);
  });

  it("has returns false for an id that was never published", () => {
    const { result } = renderHook(() => useToastBroadcast());
    expect(result.current.has("unknown")).toBe(false);
  });

  it("GC evicts entries older than BROADCAST_WINDOW_MS", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useToastBroadcast());

    act(() => result.current.publish("id-old"));

    // Advance past the GC window.
    vi.advanceTimersByTime(BROADCAST_WINDOW_MS + 1);

    expect(result.current.has("id-old")).toBe(false);

    vi.useRealTimers();
  });

  it("does not throw when BroadcastChannel is undefined", () => {
    const original = globalThis.BroadcastChannel;
    // @ts-expect-error intentional undefined
    globalThis.BroadcastChannel = undefined;
    expect(() => renderHook(() => useToastBroadcast())).not.toThrow();
    globalThis.BroadcastChannel = original;
  });
});
