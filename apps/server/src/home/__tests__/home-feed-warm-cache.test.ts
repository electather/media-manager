import { describe, it, expect, vi, beforeEach } from "vite-plus/test";

// The home-feed warm-cache regression: prior to this change, the
// preference engine ran every metadata read with `skipCache:true`, which
// blew through the dispatcher's positive cache and saturated the TMDB
// rate limit on every reload. These tests pin the expected warm-cache
// contract end-to-end through the real dispatcher.

vi.mock("../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

const invokeMock = vi.fn();
const resolveConnectionsMock = vi.fn();
const harvestIdsMock = vi.fn();
const listProvidersMock = vi.fn();
const registryAllMock = vi.fn();
const registryGetMock = vi.fn();

vi.mock("../../plugin-runtime/runtime", () => ({
  pluginRuntime: {
    invokeWithCredentials: (...args: unknown[]) => invokeMock(...args),
    refreshAuth: vi.fn(),
  },
}));

vi.mock("../../media/resolve-connection", () => ({
  resolveConnections: (...args: unknown[]) => resolveConnectionsMock(...args),
}));

vi.mock("../../media/primary-preference", () => ({
  getPrimaryConnection: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../media/id-resolver", () => ({
  harvestIds: (...args: unknown[]) => harvestIdsMock(...args),
}));

vi.mock("../../plugin-runtime/registry", () => ({
  capabilityRegistry: {
    listProviders: (...args: unknown[]) => listProvidersMock(...args),
    all: () => registryAllMock(),
    get: (...args: unknown[]) => registryGetMock(...args),
  },
}));

const dbStub = {
  update: () => ({ set: () => ({ where: async () => undefined }) }),
};
vi.mock("../../db/client", () => ({ getDb: () => dbStub }));

const { MemoryCache } = await import("../../cache/memory");
const { setCacheProviderForTest } = await import("../../media/cache");
const { MediaServicePreferenceProvider } = await import("../../preferences/media-provider");
const { dispatchPrimary, dispatchAggregatePerKind } = await import("../../media/dispatcher");

beforeEach(() => {
  invokeMock.mockReset();
  resolveConnectionsMock.mockReset();
  harvestIdsMock.mockReset();
  listProvidersMock.mockReset();
  registryAllMock.mockReset();
  registryGetMock.mockReset();
  registryAllMock.mockReturnValue([]);
  listProvidersMock.mockReturnValue(["tmdb"]);
  resolveConnectionsMock.mockResolvedValue([
    {
      kind: "user",
      pluginId: "tmdb",
      connectionId: "tmdb-conn",
      isDefault: true,
      credentials: { token: "t" },
      userConfig: {},
    },
  ]);
  setCacheProviderForTest(new MemoryCache());
});

describe("home feed warm cache (regression)", () => {
  it("a second metadata read for the same item within the cache window does not re-invoke the plugin", async () => {
    invokeMock.mockResolvedValue({
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
    });

    const provider = new MediaServicePreferenceProvider();

    const first = await provider.getItemFeatures("u1", "603", "movie");
    expect(first).not.toBeNull();
    expect(invokeMock).toHaveBeenCalledTimes(1);

    // Second call — under the previous buggy `skipCache:true` path this
    // would re-invoke the plugin and saturate the TMDB rate limit. The
    // dispatcher cache is meant to catch this.
    const second = await provider.getItemFeatures("u1", "603", "movie");
    expect(second).not.toBeNull();
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("newReleases discoverFeed reuses the cache for same-day requests", async () => {
    // Regression for the previous `Date.now()`-keyed `releaseDateLte` that
    // changed every millisecond. The row now rounds to the calendar day so
    // two calls inside the same UTC day must produce the same dispatcher
    // cache key and therefore the same single plugin invocation.
    invokeMock.mockResolvedValue([
      { id: "movie:603", title: "The Matrix", type: "movie", ids: { tmdb_id: "603" } },
    ]);

    const DAY_MS = 24 * 60 * 60 * 1000;
    const today = Math.floor(Date.now() / DAY_MS) * DAY_MS;
    const req = {
      userId: "u1",
      capability: "metadata",
      version: "v1",
      method: "discover",
      input: {
        limit: 20,
        releaseDateGte: today - 90 * DAY_MS,
        releaseDateLte: today + DAY_MS,
        sort: "popularity_desc" as const,
      },
    };

    await dispatchPrimary(req);
    expect(invokeMock).toHaveBeenCalledTimes(1);

    await dispatchPrimary(req);
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("artwork.get all-fail outcome does not re-invoke within NEGATIVE_TTL_MS", async () => {
    // Regression for the cascade where every `useArtwork` re-invoked TMDB on
    // every render after a transient outage. The dispatcher writes a short
    // negative cache when every provider fails so retries are throttled.
    listProvidersMock.mockReturnValue(["fanart"]);
    registryGetMock.mockImplementation(() => ({
      pluginId: "fanart",
      enabled: true,
      module: {
        manifest: {
          capabilities: {
            artwork: {
              version: "v1",
              scope: "global",
              supportedIdTypes: { movie: ["tmdb"], tv: ["tmdb"] },
              providerPriority: 10,
            },
          },
        },
      },
    }));
    resolveConnectionsMock.mockResolvedValue([
      {
        kind: "shared",
        pluginId: "fanart",
        connectionId: null,
        credentials: { apiKey: "k" },
        userConfig: null,
      },
    ]);
    invokeMock.mockRejectedValue(new Error("upstream down"));

    const req = {
      userId: "u1",
      capability: "artwork",
      version: "v1",
      method: "getArtwork",
      input: { ids: { tmdb: "603" }, type: "movie" as const },
    };

    await dispatchAggregatePerKind(req);
    const callsAfterFirst = invokeMock.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    await dispatchAggregatePerKind(req);
    expect(invokeMock.mock.calls.length).toBe(callsAfterFirst);
  });
});
