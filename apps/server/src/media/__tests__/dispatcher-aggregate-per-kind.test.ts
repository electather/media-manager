import { describe, it, expect, beforeEach, vi } from "vite-plus/test";

vi.mock("../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

const { MemoryCache } = await import("../../cache/memory");
const { setCacheProviderForTest } = await import("../cache");

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

vi.mock("../resolve-connection", () => ({
  resolveConnections: (...args: unknown[]) => resolveConnectionsMock(...args),
}));

vi.mock("../primary-preference", () => ({
  getPrimaryConnection: vi.fn().mockResolvedValue(null),
}));

vi.mock("../id-resolver", () => ({
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

const { dispatchAggregatePerKind } = await import("../dispatcher");
const errorsModule = await import("../errors");
const { PluginCallError } = errorsModule;
type PluginCallErrorType = InstanceType<typeof errorsModule.PluginCallError>;

interface ProviderShape {
  pluginId: string;
  supportedIdTypes: { movie: string[]; tv: string[] };
  providerPriority: number;
}

function mockRegistry(providers: ProviderShape[]): void {
  listProvidersMock.mockReturnValue(providers.map((p) => p.pluginId));
  registryGetMock.mockImplementation((pluginId: string) => {
    const provider = providers.find((p) => p.pluginId === pluginId);
    if (!provider) return undefined;
    return {
      pluginId,
      enabled: true,
      module: {
        manifest: {
          capabilities: {
            artwork: {
              version: "v1",
              scope: "global",
              supportedIdTypes: provider.supportedIdTypes,
              providerPriority: provider.providerPriority,
            },
          },
        },
      },
    };
  });
}

function emptyBundle() {
  return { poster: [], backdrop: [], clearLogo: [], thumb: [] };
}

beforeEach(() => {
  invokeMock.mockReset();
  resolveConnectionsMock.mockReset();
  harvestIdsMock.mockReset();
  listProvidersMock.mockReset();
  registryAllMock.mockReset();
  registryGetMock.mockReset();
  registryAllMock.mockReturnValue([]);
  resolveConnectionsMock.mockResolvedValue([
    {
      kind: "shared",
      pluginId: "fanart",
      connectionId: null,
      credentials: { apiKey: "k" },
      userConfig: null,
    },
  ]);
  setCacheProviderForTest(new MemoryCache());
});

describe("dispatchAggregatePerKind", () => {
  it("merges per-kind in priority order, fanart wins over TMDB", async () => {
    mockRegistry([
      {
        pluginId: "fanart",
        supportedIdTypes: { movie: ["tmdb", "imdb"], tv: ["tvdb"] },
        providerPriority: 10,
      },
      {
        pluginId: "tmdb",
        supportedIdTypes: { movie: ["tmdb"], tv: ["tmdb"] },
        providerPriority: 20,
      },
    ]);
    invokeMock.mockImplementation(async (req: { pluginId: string }) => {
      if (req.pluginId === "fanart") {
        return {
          ...emptyBundle(),
          poster: [{ url: "https://fanart/poster.jpg", language: "en", likes: 5 }],
        };
      }
      return {
        ...emptyBundle(),
        poster: [{ url: "https://tmdb/poster.jpg", language: "en", likes: 3 }],
        backdrop: [{ url: "https://tmdb/backdrop.jpg", language: "en", likes: 2 }],
      };
    });

    const result = await dispatchAggregatePerKind<{ poster: unknown[]; backdrop: unknown[] }>({
      userId: "u1",
      capability: "artwork",
      version: "v1",
      method: "getArtwork",
      input: { ids: { tmdb: "550" }, type: "movie", languages: ["en", "00"] },
    });

    expect(result.poster).toEqual([{ url: "https://fanart/poster.jpg", language: "en", likes: 5 }]);
    expect(result.backdrop).toEqual([
      { url: "https://tmdb/backdrop.jpg", language: "en", likes: 2 },
    ]);
  });

  it("skips a provider whose supportedIdTypes don't overlap the request", async () => {
    // Fanart needs tvdb for tv items; caller supplies only tmdb. TMDB is the
    // only eligible provider in this scenario.
    mockRegistry([
      {
        pluginId: "fanart",
        supportedIdTypes: { movie: ["tmdb", "imdb"], tv: ["tvdb"] },
        providerPriority: 10,
      },
      {
        pluginId: "tmdb",
        supportedIdTypes: { movie: ["tmdb"], tv: ["tmdb"] },
        providerPriority: 20,
      },
    ]);
    invokeMock.mockImplementation(async () => ({
      ...emptyBundle(),
      poster: [{ url: "https://tmdb/p.jpg", language: "en", likes: 1 }],
    }));

    const result = await dispatchAggregatePerKind<{ poster: unknown[] }>({
      userId: "u1",
      capability: "artwork",
      version: "v1",
      method: "getArtwork",
      input: { ids: { tmdb: "1396" }, type: "tv" },
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls[0]![0]).toMatchObject({ pluginId: "tmdb" });
    expect(result.poster).toEqual([{ url: "https://tmdb/p.jpg", language: "en", likes: 1 }]);
  });

  it("throws artwork.unsupported_id_combo when no provider can serve", async () => {
    // tv item with only imdb id: fanart needs tvdb, TMDB needs tmdb.
    mockRegistry([
      {
        pluginId: "fanart",
        supportedIdTypes: { movie: ["tmdb", "imdb"], tv: ["tvdb"] },
        providerPriority: 10,
      },
      {
        pluginId: "tmdb",
        supportedIdTypes: { movie: ["tmdb"], tv: ["tmdb"] },
        providerPriority: 20,
      },
    ]);

    const err = await dispatchAggregatePerKind({
      userId: "u1",
      capability: "artwork",
      version: "v1",
      method: "getArtwork",
      input: { ids: { imdb: "tt0944947" }, type: "tv" },
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PluginCallError);
    // Verify the error code so a regression that throws the wrong typed
    // error (e.g. plugin.input_invalid) doesn't slip through.
    expect((err as PluginCallErrorType).code).toBe("artwork.unsupported_id_combo");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("returns an empty bundle when every eligible provider returns empty", async () => {
    mockRegistry([
      {
        pluginId: "fanart",
        supportedIdTypes: { movie: ["tmdb", "imdb"], tv: ["tvdb"] },
        providerPriority: 10,
      },
      {
        pluginId: "tmdb",
        supportedIdTypes: { movie: ["tmdb"], tv: ["tmdb"] },
        providerPriority: 20,
      },
    ]);
    invokeMock.mockResolvedValue(emptyBundle());

    const result = await dispatchAggregatePerKind({
      userId: "u1",
      capability: "artwork",
      version: "v1",
      method: "getArtwork",
      input: { ids: { tmdb: "550" }, type: "movie" },
    });

    expect(result).toEqual(emptyBundle());
  });

  it("partial success: ignores rejected providers, merges from fulfilled ones", async () => {
    mockRegistry([
      {
        pluginId: "fanart",
        supportedIdTypes: { movie: ["tmdb", "imdb"], tv: ["tvdb"] },
        providerPriority: 10,
      },
      {
        pluginId: "tmdb",
        supportedIdTypes: { movie: ["tmdb"], tv: ["tmdb"] },
        providerPriority: 20,
      },
    ]);
    invokeMock.mockImplementation(async (req: { pluginId: string }) => {
      if (req.pluginId === "fanart") throw new Error("fanart down");
      return {
        ...emptyBundle(),
        poster: [{ url: "https://tmdb/p.jpg", language: "en", likes: 1 }],
      };
    });

    const result = await dispatchAggregatePerKind<{ poster: unknown[] }>({
      userId: "u1",
      capability: "artwork",
      version: "v1",
      method: "getArtwork",
      input: { ids: { tmdb: "550" }, type: "movie" },
    });

    expect(result.poster).toEqual([{ url: "https://tmdb/p.jpg", language: "en", likes: 1 }]);
  });

  it("excludes a provider whose manifest extras fail schema validation", async () => {
    // Plugin claims artwork but ships a malformed manifest (negative
    // priority + missing supportedIdTypes.tv). The dispatcher must skip it
    // rather than panic — and crucially, the plugin must not silently win
    // dispatch with bogus values like priority -1.
    listProvidersMock.mockReturnValue(["broken", "tmdb"]);
    registryGetMock.mockImplementation((pluginId: string) => {
      if (pluginId === "broken") {
        return {
          pluginId,
          enabled: true,
          module: {
            manifest: {
              capabilities: {
                artwork: {
                  version: "v1",
                  scope: "global",
                  supportedIdTypes: { movie: ["tmdb"] }, // missing `tv`
                  providerPriority: -1,
                },
              },
            },
          },
        };
      }
      return {
        pluginId,
        enabled: true,
        module: {
          manifest: {
            capabilities: {
              artwork: {
                version: "v1",
                scope: "global",
                supportedIdTypes: { movie: ["tmdb"], tv: ["tmdb"] },
                providerPriority: 20,
              },
            },
          },
        },
      };
    });
    invokeMock.mockResolvedValue({
      ...emptyBundle(),
      poster: [{ url: "https://tmdb/p.jpg", language: "en", likes: 1 }],
    });

    const result = await dispatchAggregatePerKind<{ poster: unknown[] }>({
      userId: "u1",
      capability: "artwork",
      version: "v1",
      method: "getArtwork",
      input: { ids: { tmdb: "550" }, type: "movie" },
    });

    // Only TMDB invoked — broken plugin filtered out by schema validation.
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls[0]![0]).toMatchObject({ pluginId: "tmdb" });
    expect(result.poster).toEqual([{ url: "https://tmdb/p.jpg", language: "en", likes: 1 }]);
  });

  it("priority tie broken alphabetical by plugin id", async () => {
    mockRegistry([
      {
        pluginId: "zeta",
        supportedIdTypes: { movie: ["tmdb"], tv: ["tmdb"] },
        providerPriority: 10,
      },
      {
        pluginId: "alpha",
        supportedIdTypes: { movie: ["tmdb"], tv: ["tmdb"] },
        providerPriority: 10,
      },
    ]);
    invokeMock.mockImplementation(async (req: { pluginId: string }) => ({
      ...emptyBundle(),
      poster: [{ url: `https://${req.pluginId}/p.jpg`, language: "en", likes: 1 }],
    }));

    const result = await dispatchAggregatePerKind<{ poster: { url: string }[] }>({
      userId: "u1",
      capability: "artwork",
      version: "v1",
      method: "getArtwork",
      input: { ids: { tmdb: "550" }, type: "movie" },
    });

    expect(result.poster[0]!.url).toBe("https://alpha/p.jpg");
  });

  it("caches the merged result on success", async () => {
    mockRegistry([
      {
        pluginId: "fanart",
        supportedIdTypes: { movie: ["tmdb", "imdb"], tv: ["tvdb"] },
        providerPriority: 10,
      },
    ]);
    invokeMock.mockResolvedValueOnce({
      ...emptyBundle(),
      poster: [{ url: "https://fanart/p.jpg", language: "en", likes: 1 }],
    });

    const req = {
      userId: "u1",
      capability: "artwork",
      version: "v1",
      method: "getArtwork",
      input: { ids: { tmdb: "550" }, type: "movie" as const, languages: ["en", "00"] },
    };
    await dispatchAggregatePerKind(req);
    await dispatchAggregatePerKind(req);

    // Second call hits cache; no additional plugin invocation.
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("negative-caches an empty bundle at NEGATIVE_TTL_MS when every provider fails", async () => {
    mockRegistry([
      {
        pluginId: "fanart",
        supportedIdTypes: { movie: ["tmdb", "imdb"], tv: ["tvdb"] },
        providerPriority: 10,
      },
    ]);
    invokeMock.mockRejectedValue(new Error("upstream down"));

    // Spy on the cache provider's `set` so we can assert the TTL the
    // dispatcher chose for the all-fail outcome.
    const cache = new MemoryCache();
    const setSpy = vi.spyOn(cache, "set");
    setCacheProviderForTest(cache);

    const req = {
      userId: "u1",
      capability: "artwork",
      version: "v1",
      method: "getArtwork",
      input: { ids: { tmdb: "550" }, type: "movie" as const },
    };
    const first = await dispatchAggregatePerKind(req);
    expect(first).toEqual(emptyBundle());
    const callsAfterFirst = invokeMock.mock.calls.length;

    // Cache write happened, and the TTL is the short negative window so a
    // transient TMDB outage doesn't poison the 24h positive cache.
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy.mock.calls[0]![2]).toBe(60 * 1000);

    await dispatchAggregatePerKind(req);
    expect(invokeMock.mock.calls.length).toBe(callsAfterFirst);
  });
});
