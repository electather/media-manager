import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const memStore = new Map<string, string>();

vi.mock("idb-keyval", () => ({
  createStore: vi.fn(() => "test-store"),
  get: vi.fn(async (key: string) => memStore.get(key)),
  set: vi.fn(async (key: string, value: string) => {
    memStore.set(key, value);
  }),
  del: vi.fn(async (key: string) => {
    memStore.delete(key);
  }),
}));

import { buster, dehydrateOptions, idbStorage } from "../persister";

beforeEach(() => {
  memStore.clear();
});

afterEach(() => {
  memStore.clear();
});

describe("dehydrateOptions.shouldDehydrateQuery", () => {
  it("returns false when meta.persist === false", () => {
    const query = { meta: { persist: false } } as never;
    expect(dehydrateOptions.shouldDehydrateQuery(query)).toBe(false);
  });

  it("returns true when meta is undefined", () => {
    const query = { meta: undefined } as never;
    expect(dehydrateOptions.shouldDehydrateQuery(query)).toBe(true);
  });

  it("returns true when meta.persist is omitted", () => {
    const query = { meta: {} } as never;
    expect(dehydrateOptions.shouldDehydrateQuery(query)).toBe(true);
  });

  it("returns true when meta.persist === true", () => {
    const query = { meta: { persist: true } } as never;
    expect(dehydrateOptions.shouldDehydrateQuery(query)).toBe(true);
  });
});

describe("buster", () => {
  it("combines VITE_APP_VERSION and VITE_SHARED_VERSION with a dash", () => {
    expect(buster).toBe(
      `${import.meta.env.VITE_APP_VERSION}-${import.meta.env.VITE_SHARED_VERSION}`,
    );
  });

  it("contains both version values", () => {
    expect(buster).toContain(import.meta.env.VITE_APP_VERSION);
    expect(buster).toContain(import.meta.env.VITE_SHARED_VERSION);
  });
});

describe("idbStorage", () => {
  it("round-trips a string through idb-keyval", async () => {
    await idbStorage.setItem("key-a", "value-a");
    expect(await idbStorage.getItem("key-a")).toBe("value-a");
  });

  it("returns null for missing keys", async () => {
    expect(await idbStorage.getItem("missing")).toBeNull();
  });

  it("removeItem deletes the key", async () => {
    await idbStorage.setItem("key-b", "value-b");
    await idbStorage.removeItem("key-b");
    expect(await idbStorage.getItem("key-b")).toBeNull();
  });
});
