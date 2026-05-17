import { describe, it, expect, vi } from "vite-plus/test";

vi.mock("../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

const dispatchPrimaryMock = vi.fn();
vi.mock("../../media", async () => {
  const actual = await vi.importActual<typeof import("../../media")>("../../media");
  return {
    ...actual,
    dispatchPrimary: (...args: unknown[]) => dispatchPrimaryMock(...args),
    dispatchAggregate: vi.fn(async () => ({ data: [] })),
  };
});

const { MediaServicePreferenceProvider } = await import("../media-provider");

describe("MediaServicePreferenceProvider.getItemFeatures", () => {
  it("does not pass skipCache:true — the metadata cache is what keeps TMDB rate-limited rebuilds healthy", async () => {
    dispatchPrimaryMock.mockReset();
    dispatchPrimaryMock.mockResolvedValue({
      data: {
        id: "movie:603",
        type: "movie",
        title: "The Matrix",
        genres: ["Action"],
        runtime: 136,
        keywords: ["dystopia"],
        cast: ["Keanu Reeves"],
        director: "The Wachowskis",
        originalLanguage: "en",
        ids: { tmdb_id: "603" },
      },
    });

    const provider = new MediaServicePreferenceProvider();
    const features = await provider.getItemFeatures("u1", "603", "movie");

    expect(features).not.toBeNull();
    expect(dispatchPrimaryMock).toHaveBeenCalledTimes(1);
    const payload = dispatchPrimaryMock.mock.calls[0]![0] as Record<string, unknown>;
    // Bug regression: the prior implementation forced skipCache:true here,
    // which routed every recommend-rank pass through the live TMDB fetcher
    // and saturated the rate limit on warm reloads.
    expect(payload.skipCache).not.toBe(true);
  });
});
