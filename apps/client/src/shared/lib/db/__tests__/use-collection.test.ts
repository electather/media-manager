// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createCollectionRegistry } from "../use-collection";

interface FakeCollection {
  cleanup: () => Promise<void>;
  key: string;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function buildRegistry() {
  const cleanups: string[] = [];
  const factoryCalls: string[] = [];
  const factory = vi.fn((key: string): FakeCollection => {
    factoryCalls.push(key);
    return {
      key,
      cleanup: async () => {
        cleanups.push(key);
      },
    };
  });
  return { registry: createCollectionRegistry(factory), factory, factoryCalls, cleanups };
}

describe("createCollectionRegistry", () => {
  it("returns the same instance for the same key while alive", () => {
    const { registry } = buildRegistry();
    const a = registry.acquire("job-1");
    const b = registry.acquire("job-1");
    expect(a).toBe(b);
  });

  it("defers cleanup until idle window elapses", () => {
    const { registry, cleanups } = buildRegistry();
    registry.acquire("job-1");
    registry.release("job-1");
    expect(cleanups).toEqual([]);
    vi.advanceTimersByTime(29_999);
    expect(cleanups).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(cleanups).toEqual(["job-1"]);
  });

  it("cancels pending cleanup if reacquired within idle window", () => {
    const { registry, cleanups, factoryCalls } = buildRegistry();
    const first = registry.acquire("job-1");
    registry.release("job-1");
    vi.advanceTimersByTime(15_000);
    const second = registry.acquire("job-1");
    expect(second).toBe(first);
    vi.advanceTimersByTime(60_000);
    expect(cleanups).toEqual([]);
    expect(factoryCalls).toEqual(["job-1"]);
  });

  it("peek returns the live instance without acquiring", () => {
    const { registry } = buildRegistry();
    expect(registry.peek("job-1")).toBeNull();
    const acquired = registry.acquire("job-1");
    expect(registry.peek("job-1")).toBe(acquired);
  });

  it("supports independent keys with independent lifecycles", () => {
    const { registry, cleanups } = buildRegistry();
    registry.acquire("job-1");
    registry.acquire("job-2");
    registry.release("job-1");
    vi.advanceTimersByTime(31_000);
    expect(cleanups).toEqual(["job-1"]);
    registry.release("job-2");
    vi.advanceTimersByTime(31_000);
    expect(cleanups).toEqual(["job-1", "job-2"]);
  });
});
