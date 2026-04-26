import { describe, it, expect, vi } from "vite-plus/test";
import { RequestScopedLoader } from "../dataloader";
import type { MediaService } from "../../media/service";

/**
 * The loader is the single coalescing point in the home feed: every test
 * here verifies that two callers asking for the same thing produce one
 * underlying call. Real `MediaService` is heavy to construct in unit tests;
 * we substitute a hand-rolled stub that records call counts directly.
 */
type Stub = MediaService & {
  metadataCalls: string[];
  inProgressCalls: number;
  statusBatchCalls: string[][];
  hasCapabilityCalls: string[];
};

function makeStub(): Stub {
  const stub = {
    userId: "u1",
    metadataCalls: [] as string[],
    inProgressCalls: 0,
    statusBatchCalls: [] as string[][],
    hasCapabilityCalls: [] as string[],
    async getDetails(id: string) {
      stub.metadataCalls.push(id);
      return { id };
    },
    async getInProgress() {
      stub.inProgressCalls += 1;
      return {
        items: [{ item: { id: "movie:550" } }, { item: { id: "tv:1396" } }],
        partial: false,
      };
    },
    async getStatusBatch(ids: ReadonlyArray<string>) {
      stub.statusBatchCalls.push([...ids]);
      const out: Record<string, string> = {};
      for (const id of ids) out[id] = "available";
      return out;
    },
    async hasCapabilityProvider(capability: string, version: string) {
      stub.hasCapabilityCalls.push(`${capability}@${version}`);
      return true;
    },
  };
  return stub as unknown as Stub;
}

describe("RequestScopedLoader", () => {
  it("memoizes getMetadata across two callers", async () => {
    const stub = makeStub();
    const loader = new RequestScopedLoader(stub, "u1");
    await Promise.all([loader.getMetadata("movie:550"), loader.getMetadata("movie:550")]);
    expect(stub.metadataCalls).toEqual(["movie:550"]);
  });

  it("coalesces getStatusBatch calls in the same microtask", async () => {
    const stub = makeStub();
    const loader = new RequestScopedLoader(stub, "u1");
    const [a, b] = await Promise.all([
      loader.getStatusBatch(["movie:550"]),
      loader.getStatusBatch(["tv:1396"]),
    ]);
    expect(stub.statusBatchCalls).toHaveLength(1);
    expect(new Set(stub.statusBatchCalls[0])).toEqual(new Set(["movie:550", "tv:1396"]));
    expect(a["movie:550"]).toBe("available");
    expect(b["tv:1396"]).toBe("available");
    // Each caller only gets back the keys it asked for.
    expect(a["tv:1396"]).toBeUndefined();
    expect(b["movie:550"]).toBeUndefined();
  });

  it("returns getStatusBatch keys verbatim — composite ids, not bare tmdb ids", async () => {
    const stub = makeStub();
    const loader = new RequestScopedLoader(stub, "u1");
    const result = await loader.getStatusBatch(["movie:550"]);
    expect(Object.keys(result)).toEqual(["movie:550"]);
  });

  it("memoizes getInProgressSet across two callers", async () => {
    const stub = makeStub();
    const loader = new RequestScopedLoader(stub, "u1");
    const [setA, setB] = await Promise.all([loader.getInProgressSet(), loader.getInProgressSet()]);
    expect(stub.inProgressCalls).toBe(1);
    expect(setA).toBe(setB);
    expect(setA).toEqual(new Set(["movie:550", "tv:1396"]));
  });

  it("memoizes hasPlugin per requirement string", async () => {
    const stub = makeStub();
    const loader = new RequestScopedLoader(stub, "u1");
    await Promise.all([
      loader.hasPlugin("watchHistory@v1"),
      loader.hasPlugin("watchHistory@v1"),
      loader.hasPlugin("watchlist@v1"),
    ]);
    expect(stub.hasCapabilityCalls).toEqual(["watchHistory@v1", "watchlist@v1"]);
  });

  it("propagates errors from the underlying call to every awaiter of getMetadata", async () => {
    const stub = makeStub();
    const failing = vi.fn().mockRejectedValue(new Error("boom"));
    (stub as unknown as { getDetails: typeof failing }).getDetails = failing;
    const loader = new RequestScopedLoader(stub, "u1");
    await expect(loader.getMetadata("movie:0")).rejects.toThrow(/boom/);
    // After failure the cache cleared so a retry hits the upstream again.
    await expect(loader.getMetadata("movie:0")).rejects.toThrow(/boom/);
    expect(failing).toHaveBeenCalledTimes(2);
  });
});
