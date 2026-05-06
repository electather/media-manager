import { describe, expect, it, vi } from "vite-plus/test";
import { StatusBatchMemo } from "../status-batch";
import type { MediaService } from "../../media/service";

function fakeMediaService(impl: (ids: string[]) => Promise<Record<string, string>>) {
  return {
    getStatusBatch: vi.fn(impl),
  } as unknown as MediaService;
}

describe("StatusBatchMemo", () => {
  it("returns an empty map for an empty input", async () => {
    const svc = fakeMediaService(async () => ({}));
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const spy = svc.getStatusBatch as unknown as { mock: { calls: unknown[][] } };
    const memo = new StatusBatchMemo(svc);
    expect(await memo.get([])).toEqual({});
    expect(spy.mock.calls).toHaveLength(0);
  });

  it("collapses repeat lookups into a single round-trip", async () => {
    const svc = fakeMediaService(async (ids) =>
      Object.fromEntries(ids.map((id) => [id, "available"])),
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const spy = svc.getStatusBatch as unknown as { mock: { calls: unknown[][] } };
    const memo = new StatusBatchMemo(svc);
    await memo.get(["1", "2"]);
    await memo.get(["1", "2", "3"]);
    expect(spy.mock.calls).toHaveLength(2);
    // Second call only fetched the missing id.
    expect(spy.mock.calls[1]).toEqual([["3"]]);
  });

  it("defaults missing ids to 'unknown'", async () => {
    const svc = fakeMediaService(async () => ({ "1": "available" }));
    const memo = new StatusBatchMemo(svc);
    const res = await memo.get(["1", "2"]);
    expect(res).toEqual({ "1": "available", "2": "unknown" });
  });

  it("dedups concurrent overlapping fetches into a single round-trip", async () => {
    const resolvers: Array<(v: Record<string, string>) => void> = [];
    const svc = fakeMediaService(
      (ids) =>
        new Promise<Record<string, string>>((resolve) => {
          resolvers.push(() => resolve(Object.fromEntries(ids.map((id) => [id, "available"]))));
        }),
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const spy = svc.getStatusBatch as unknown as { mock: { calls: unknown[][] } };
    const memo = new StatusBatchMemo(svc);
    const a = memo.get(["movie:1", "movie:2"]);
    const b = memo.get(["movie:2", "movie:3"]);
    // Both calls fire before either resolves; the second must not re-request
    // `movie:2` on the wire.
    expect(spy.mock.calls).toHaveLength(2);
    expect(spy.mock.calls[1]).toEqual([["movie:3"]]);
    for (const r of resolvers) r({});
    const [resA, resB] = await Promise.all([a, b]);
    expect(resA).toEqual({ "movie:1": "available", "movie:2": "available" });
    expect(resB).toEqual({ "movie:2": "available", "movie:3": "available" });
  });
});
