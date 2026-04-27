import { describe, it, expect, beforeEach, vi } from "vite-plus/test";
import type { ArtworkBundle } from "@ent-mcp/shared/artwork";

// `vi.mock` is hoisted above any module-scope `const`, so `dispatchMock` has
// to be hoisted alongside it — otherwise the factory closure captures
// `undefined` and the call wrapper dies with `TypeError: undefined is not a
// function`.
const { dispatchMock } = vi.hoisted(() => ({ dispatchMock: vi.fn() }));
vi.mock("../../media/strategies/aggregate-per-kind", () => ({
  dispatchAggregatePerKind: dispatchMock,
}));

const { ArtworkService } = await import("../service");
const { PluginCallError } = await import("../../media/errors");

function bundle(overrides: Partial<ArtworkBundle> = {}): ArtworkBundle {
  return {
    poster: [],
    backdrop: [],
    clearLogo: [],
    thumb: [],
    ...overrides,
  };
}

beforeEach(() => dispatchMock.mockReset());

describe("ArtworkService", () => {
  it("dispatches one call per canonical (idsHash, type) and echoes back every client key", async () => {
    dispatchMock.mockResolvedValue(
      bundle({ poster: [{ url: "https://x/p.jpg", language: "en" }] }),
    );
    const service = new ArtworkService("u1");
    // Two distinct client keys map to the same canonical entry — service must
    // collapse them into a single dispatch but still return both keys in the
    // results map.
    const result = await service.getArtwork([
      { key: "row1-card", ids: { tmdb: "550" }, type: "movie" },
      { key: "row2-card", ids: { tmdb: "550" }, type: "movie" },
      { key: "row3-card", ids: { tmdb: "1396" }, type: "tv" },
    ]);

    expect(dispatchMock).toHaveBeenCalledTimes(2);
    expect(Object.keys(result.results).sort()).toEqual(["row1-card", "row2-card", "row3-card"]);
    expect(result.results["row1-card"]).toEqual(result.results["row2-card"]);
    expect(result.errors).toBeUndefined();
  });

  it("captures unsupported_id_combo per item without breaking the batch", async () => {
    // Order matches Map.values() insertion order: movie comes before tv since
    // that is the order the input items are walked into the canonical map.
    dispatchMock
      .mockResolvedValueOnce(bundle({ poster: [{ url: "https://x/p.jpg", language: "en" }] }))
      .mockRejectedValueOnce(
        new PluginCallError(
          "artwork.unsupported_id_combo",
          "no provider for tv with imdb",
          "",
          null,
        ),
      );
    const service = new ArtworkService("u1");
    const result = await service.getArtwork([
      { key: "ok", ids: { tmdb: "550" }, type: "movie" },
      { key: "bad", ids: { imdb: "tt1" }, type: "tv" },
    ]);

    expect(result.results["ok"]).toBeDefined();
    expect(result.results["bad"]).toBeUndefined();
    expect(result.errors?.["bad"]).toEqual({
      code: "unsupported_id_combo",
      message: "no provider for tv with imdb",
    });
  });

  it("maps unexpected dispatch failures to a generic 'internal' per-item error", async () => {
    dispatchMock.mockRejectedValueOnce(new Error("registry blew up"));
    const service = new ArtworkService("u1");
    const result = await service.getArtwork([{ key: "k", ids: { tmdb: "550" }, type: "movie" }]);
    expect(result.results["k"]).toBeUndefined();
    expect(result.errors?.["k"]?.code).toBe("internal");
  });

  it("forwards the caller's languages preference into the dispatch input", async () => {
    dispatchMock.mockResolvedValue(bundle());
    await new ArtworkService("u1").getArtwork(
      [{ key: "k", ids: { tmdb: "550" }, type: "movie" }],
      ["fr", "en", "00"],
    );
    expect(dispatchMock.mock.calls[0]![0]).toMatchObject({
      input: { ids: { tmdb: "550" }, type: "movie", languages: ["fr", "en", "00"] },
    });
  });

  it("defaults languages to ['en', '00'] when the caller omits it", async () => {
    dispatchMock.mockResolvedValue(bundle());
    await new ArtworkService("u1").getArtwork([{ key: "k", ids: { tmdb: "550" }, type: "movie" }]);
    expect(dispatchMock.mock.calls[0]![0]).toMatchObject({
      input: { languages: ["en", "00"] },
    });
  });
});
