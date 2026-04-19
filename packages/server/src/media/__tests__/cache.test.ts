import { describe, it, expect, vi } from "vite-plus/test";

vi.mock("../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

const { argsHash, cacheKey, canonicalize, ttlMsFor } = await import("../cache");
const { MetadataV1, WatchHistoryV1 } = await import("../../plugin-runtime/capabilities");

describe("canonicalize", () => {
  it("produces identical output regardless of key order", () => {
    const a = canonicalize({ b: 2, a: 1 });
    const b = canonicalize({ a: 1, b: 2 });
    expect(a).toBe(b);
  });

  it("omits undefined properties", () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("serializes arrays positionally", () => {
    expect(canonicalize([1, 2, { z: 9 }])).toBe('[1,2,{"z":9}]');
  });

  it("distinguishes null from missing", () => {
    expect(canonicalize({ a: null })).not.toBe(canonicalize({}));
  });
});

describe("argsHash", () => {
  it("returns 16 hex chars", async () => {
    const h = await argsHash({ query: "matrix" });
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is stable across key order", async () => {
    expect(await argsHash({ a: 1, b: 2 })).toBe(await argsHash({ b: 2, a: 1 }));
  });
});

describe("cacheKey", () => {
  it("uses a global scope when capability is not user-scoped", async () => {
    const key = await cacheKey({
      capability: "metadata",
      version: "v1",
      method: "search",
      userId: "u1",
      userScoped: false,
      input: { query: "x" },
    });
    expect(key).toMatch(/^mv:metadata:v1:search:global:[0-9a-f]{16}$/);
  });

  it("includes the user id when the capability is user-scoped", async () => {
    const key = await cacheKey({
      capability: "watchHistory",
      version: "v1",
      method: "getHistory",
      userId: "alice",
      userScoped: true,
      input: {},
    });
    expect(key).toMatch(/^mv:watchHistory:v1:getHistory:user:alice:[0-9a-f]{16}$/);
  });

  it("produces distinct keys for distinct inputs", async () => {
    const base = {
      capability: "metadata",
      version: "v1",
      method: "search",
      userId: "u1",
      userScoped: false,
    };
    const k1 = await cacheKey({ ...base, input: { query: "a" } });
    const k2 = await cacheKey({ ...base, input: { query: "b" } });
    expect(k1).not.toBe(k2);
  });
});

describe("ttlMsFor", () => {
  it("uses defaultCacheTtlSec for non-empty payloads", () => {
    const ttl = ttlMsFor(MetadataV1, [{ item: {} }]);
    expect(ttl).toBe(MetadataV1.defaultCacheTtlSec * 1000);
  });

  it("uses negativeCacheTtlSec for null", () => {
    const ttl = ttlMsFor(MetadataV1, null);
    expect(ttl).toBe(MetadataV1.negativeCacheTtlSec * 1000);
  });

  it("uses negativeCacheTtlSec for an empty array", () => {
    const ttl = ttlMsFor(WatchHistoryV1, []);
    expect(ttl).toBe(WatchHistoryV1.negativeCacheTtlSec * 1000);
  });

  it("uses negativeCacheTtlSec for an empty object", () => {
    const ttl = ttlMsFor(MetadataV1, {});
    expect(ttl).toBe(MetadataV1.negativeCacheTtlSec * 1000);
  });
});
