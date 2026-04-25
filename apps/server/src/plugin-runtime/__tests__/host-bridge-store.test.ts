import { describe, it, expect, beforeEach, vi } from "vite-plus/test";

vi.mock("../../env", () => ({
  env: { ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef" },
}));

interface StoreRow {
  pluginId: string;
  userId: string | null;
  key: string;
  value: string;
  expiresAt: number | null;
  createdAt: number;
  updatedAt: number;
}

const rows: StoreRow[] = [];

// Minimal predicate tokens returned by our mocked drizzle operators so the
// in-memory db can filter rows without running SQL.
type Predicate =
  | { op: "and"; conds: Predicate[] }
  | { op: "eq"; col: keyof StoreRow; val: unknown }
  | { op: "isNull"; col: keyof StoreRow }
  | { op: "lt"; col: keyof StoreRow; val: number };

function evalPred(row: StoreRow, pred: Predicate): boolean {
  switch (pred.op) {
    case "and":
      return pred.conds.every((c) => evalPred(row, c));
    case "eq":
      return row[pred.col] === pred.val;
    case "isNull":
      return row[pred.col] === null;
    case "lt": {
      const v = row[pred.col];
      return typeof v === "number" && v < pred.val;
    }
  }
}

vi.mock("drizzle-orm", () => ({
  and: (...conds: Predicate[]): Predicate => ({ op: "and", conds }),
  eq: (col: { __name: keyof StoreRow }, val: unknown): Predicate => ({
    op: "eq",
    col: col.__name,
    val,
  }),
  isNull: (col: { __name: keyof StoreRow }): Predicate => ({ op: "isNull", col: col.__name }),
  lt: (col: { __name: keyof StoreRow }, val: number): Predicate => ({
    op: "lt",
    col: col.__name,
    val,
  }),
}));

vi.mock("../../db/schema/plugins", () => {
  const col = <K extends keyof StoreRow>(name: K) => ({ __name: name });
  return {
    pluginStore: {
      pluginId: col("pluginId"),
      userId: col("userId"),
      key: col("key"),
      value: col("value"),
      expiresAt: col("expiresAt"),
      createdAt: col("createdAt"),
      updatedAt: col("updatedAt"),
    },
  };
});

const dbMock = {
  select(_cols?: unknown) {
    return {
      from(_table: unknown) {
        return {
          where(pred: Predicate) {
            const matched = rows.filter((r) => evalPred(r, pred));
            return {
              async get() {
                return matched[0];
              },
              async all() {
                return matched;
              },
            };
          },
        };
      },
    };
  },
  insert(_table: unknown) {
    return {
      async values(row: StoreRow) {
        rows.push({ ...row });
      },
    };
  },
  update(_table: unknown) {
    return {
      set(patch: Partial<StoreRow>) {
        return {
          async where(pred: Predicate) {
            for (const r of rows) {
              if (evalPred(r, pred)) Object.assign(r, patch);
            }
          },
        };
      },
    };
  },
  delete(_table: unknown) {
    return {
      where(pred: Predicate) {
        const deleted = rows.filter((r) => evalPred(r, pred));
        for (const r of deleted) {
          const idx = rows.indexOf(r);
          if (idx >= 0) rows.splice(idx, 1);
        }
        return Object.assign(Promise.resolve(), {
          async returning(_sel: unknown) {
            return deleted.map((r) => ({ key: r.key }));
          },
        });
      },
    };
  },
};

vi.mock("../../db/client", () => ({ getDb: () => dbMock }));

const { buildStore, sweepExpiredStore } = await import("../host-bridge");

beforeEach(() => {
  rows.length = 0;
});

describe("buildStore", () => {
  it("roundtrips a JSON value within the same scope", async () => {
    const store = buildStore("tmdb", "user-1");
    await store.set("session", { token: "abc" });
    await expect(store.get("session")).resolves.toEqual({ token: "abc" });
  });

  it("returns undefined for a missing key instead of throwing", async () => {
    const store = buildStore("tmdb", "user-1");
    await expect(store.get("missing")).resolves.toBeUndefined();
  });

  it("returns undefined once a TTL has elapsed", async () => {
    const store = buildStore("tmdb", "user-1");
    await store.set("t", { n: 1 }, { ttlSec: 10 });
    // Force the stored row into the past without waiting on real time.
    for (const r of rows) r.expiresAt = Date.now() - 1;
    await expect(store.get("t")).resolves.toBeUndefined();
  });

  it("isolates user-scoped entries by userId", async () => {
    const a = buildStore("tmdb", "user-a");
    const b = buildStore("tmdb", "user-b");
    await a.set("k", { who: "a" });
    await b.set("k", { who: "b" });
    await expect(a.get("k")).resolves.toEqual({ who: "a" });
    await expect(b.get("k")).resolves.toEqual({ who: "b" });
  });

  it("separates global scope from user scope even under the same caller", async () => {
    const store = buildStore("tmdb", "user-1");
    await store.set("k", { who: "user" });
    await store.set("k", { who: "global" }, { scope: "global" });
    await expect(store.get("k")).resolves.toEqual({ who: "user" });
    await expect(store.get("k", { scope: "global" })).resolves.toEqual({ who: "global" });
  });

  it("delete with scope=global removes the global row without touching user rows", async () => {
    const store = buildStore("tmdb", "user-1");
    await store.set("k", { who: "user" });
    await store.set("k", { who: "global" }, { scope: "global" });
    await store.delete("k", { scope: "global" });
    await expect(store.get("k", { scope: "global" })).resolves.toBeUndefined();
    await expect(store.get("k")).resolves.toEqual({ who: "user" });
  });

  it("overwrites an existing value instead of inserting a duplicate row", async () => {
    const store = buildStore("tmdb", "user-1");
    await store.set("k", { v: 1 });
    await store.set("k", { v: 2 });
    expect(rows).toHaveLength(1);
    await expect(store.get("k")).resolves.toEqual({ v: 2 });
  });
});

describe("sweepExpiredStore", () => {
  it("deletes only rows whose expiresAt is in the past", async () => {
    const store = buildStore("tmdb", "user-1");
    await store.set("fresh", { n: 1 }, { ttlSec: 3600 });
    await store.set("stale", { n: 2 }, { ttlSec: 3600 });
    await store.set("noTtl", { n: 3 });
    // Age the "stale" entry out of the window.
    for (const r of rows) if (r.key === "stale") r.expiresAt = Date.now() - 1;

    const deleted = await sweepExpiredStore();
    expect(deleted).toBe(1);
    expect(rows.map((r) => r.key).sort()).toEqual(["fresh", "noTtl"]);
  });
});
