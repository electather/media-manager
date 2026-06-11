import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vite-plus/test";

import { rollbackQuery, snapshotQuery } from "../optimistic";

const KEY = ["optimistic-test"] as const;

describe("snapshotQuery", () => {
  it("cancels in-flight queries for the key before snapshotting", async () => {
    const qc = new QueryClient();
    const cancel = vi.spyOn(qc, "cancelQueries");

    await snapshotQuery<number>(qc, KEY);

    // Cancelling avoids a racing refetch clobbering the optimistic write.
    expect(cancel).toHaveBeenCalledWith({ queryKey: KEY });
  });

  it("returns the current cache entry as the snapshot", async () => {
    const qc = new QueryClient();
    qc.setQueryData(KEY, 1);

    const { prev } = await snapshotQuery<number>(qc, KEY);

    expect(prev).toBe(1);
  });

  it("applies the optimistic updater to the cache when provided", async () => {
    const qc = new QueryClient();
    qc.setQueryData(KEY, 1);

    const { prev } = await snapshotQuery<number>(qc, KEY, (cur) => (cur ?? 0) + 10);

    // The returned snapshot is the pre-update value so rollback can restore it.
    expect(prev).toBe(1);
    expect(qc.getQueryData(KEY)).toBe(11);
  });
});

describe("rollbackQuery", () => {
  it("restores a captured snapshot into the cache entry", () => {
    const qc = new QueryClient();
    qc.setQueryData(KEY, 99);

    rollbackQuery(qc, KEY, 1);

    expect(qc.getQueryData(KEY)).toBe(1);
  });

  it("is a no-op for an undefined snapshot rather than deleting the entry", () => {
    const qc = new QueryClient();
    qc.setQueryData(KEY, 42);

    // setQueryData(key, undefined) would remove the entry; the guard prevents
    // a rollback-with-no-snapshot from wiping live cache data.
    rollbackQuery<number>(qc, KEY, undefined);

    expect(qc.getQueryData(KEY)).toBe(42);
  });
});
