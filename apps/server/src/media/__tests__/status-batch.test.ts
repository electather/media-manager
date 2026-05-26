import { describe, expect, it, vi } from "vite-plus/test";
import { StatusBatchMemo } from "../status-batch";
import type { MediaEnrichService } from "../types";

function fakeMediaService(impl: (ids: string[]) => Promise<Record<string, string>>) {
  const getStatusBatch = vi.fn(impl);
  return {
    service: { getStatusBatch } as unknown as MediaEnrichService,
    getStatusBatch,
  };
}

describe("StatusBatchMemo", () => {
  it("returns an empty map for an empty input", async () => {
    const { service, getStatusBatch } = fakeMediaService(async () => ({}));
    const memo = new StatusBatchMemo(service);
    expect(await memo.get([])).toEqual({});
    expect(getStatusBatch).not.toHaveBeenCalled();
  });

  it("collapses repeat lookups into a single round-trip", async () => {
    const { service, getStatusBatch } = fakeMediaService(async (ids) =>
      Object.fromEntries(ids.map((id) => [id, "available"])),
    );
    const memo = new StatusBatchMemo(service);
    await memo.get(["1", "2"]);
    await memo.get(["1", "2", "3"]);
    expect(getStatusBatch).toHaveBeenCalledTimes(2);
    expect(getStatusBatch.mock.calls[1]).toEqual([["3"], {}]);
  });

  it("defaults missing ids to unknown", async () => {
    const { service } = fakeMediaService(async () => ({ "1": "available" }));
    const memo = new StatusBatchMemo(service);
    const res = await memo.get(["1", "2"]);
    expect(res).toEqual({ "1": "available", "2": "unknown" });
  });

  it("dedups concurrent overlapping fetches into a single round-trip", async () => {
    const resolvers: Array<(v: Record<string, string>) => void> = [];
    const { service, getStatusBatch } = fakeMediaService(
      (ids) =>
        new Promise<Record<string, string>>((resolve) => {
          resolvers.push(() => resolve(Object.fromEntries(ids.map((id) => [id, "available"]))));
        }),
    );
    const memo = new StatusBatchMemo(service);
    const a = memo.get(["movie:1", "movie:2"]);
    const b = memo.get(["movie:2", "movie:3"]);

    expect(getStatusBatch).toHaveBeenCalledTimes(2);
    expect(getStatusBatch.mock.calls[1]).toEqual([["movie:3"], {}]);
    for (const resolve of resolvers) resolve({});
    const [resA, resB] = await Promise.all([a, b]);
    expect(resA).toEqual({ "movie:1": "available", "movie:2": "available" });
    expect(resB).toEqual({ "movie:2": "available", "movie:3": "available" });
  });
});
