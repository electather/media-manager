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
  setPrimaryConnection: vi.fn(),
  clearPrimaryConnection: vi.fn(),
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
});
