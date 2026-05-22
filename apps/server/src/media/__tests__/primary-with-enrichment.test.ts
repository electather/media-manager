import { describe, it, expect, beforeEach, vi } from "vite-plus/test";
import { PluginError } from "@ent-mcp/plugin-sdk";

vi.mock("../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

const { MemoryCache } = await import("../../cache/memory");
const { setCacheProviderForTest } = await import("../service/cache");

const invokeMock = vi.fn();
const resolveConnectionsMock = vi.fn();
const getPrimaryMock = vi.fn();
const harvestIdsMock = vi.fn();
const listProvidersMock = vi.fn();
const registryAllMock = vi.fn();
const pickSingleMock = vi.fn();

vi.mock("../../plugin-runtime/service/runtime", () => ({
  pluginRuntime: {
    invoke: (...args: unknown[]) => invokeMock(...args),
    invokeWithCredentials: (...args: unknown[]) => invokeMock(...args),
    refreshAuth: vi.fn(),
  },
}));

vi.mock("../internal/resolve-connection", () => ({
  resolveConnections: (...args: unknown[]) => resolveConnectionsMock(...args),
}));

vi.mock("../service/primary-preference", () => ({
  getPrimaryConnection: (...args: unknown[]) => getPrimaryMock(...args),
  setPrimaryConnection: vi.fn(),
  clearPrimaryConnection: vi.fn(),
}));

vi.mock("../service/id-resolver", () => ({
  harvestIds: (...args: unknown[]) => harvestIdsMock(...args),
}));

vi.mock("../internal/capability-lookup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../internal/capability-lookup")>();
  return {
    ...actual,
    pickSingleConnection: (...args: unknown[]) => pickSingleMock(...args),
  };
});

vi.mock("../../plugin-runtime/internal/registry", () => ({
  capabilityRegistry: {
    listProviders: (...args: unknown[]) => listProvidersMock(...args),
    all: () => registryAllMock(),
  },
}));

const dbStub = {
  update: () => ({ set: () => ({ where: async () => undefined }) }),
};
vi.mock("../../db/client", () => ({ getDb: () => dbStub }));

vi.mock("../../crypto/hash", () => ({
  sha256: async (s: string) => s.slice(0, 32).padEnd(32, "0"),
}));

const { dispatchPrimary } = await import("../internal/strategies/primary-with-enrichment");

interface UserConn {
  kind: "user";
  pluginId: string;
  connectionId: string;
  isDefault: boolean;
  credentials: unknown;
  userConfig: unknown;
}

function userConn(pluginId: string, connectionId = `${pluginId}-conn`): UserConn {
  return {
    kind: "user",
    pluginId,
    connectionId,
    isDefault: true,
    credentials: { token: "t" },
    userConfig: {},
  };
}

function req(overrides: Record<string, unknown> = {}) {
  return {
    userId: "u1",
    capability: "metadata",
    version: "v1",
    method: "getDetails",
    input: { id: "42", type: "movie" },
    mediaType: "movie" as const,
    ...overrides,
  };
}

beforeEach(() => {
  invokeMock.mockReset();
  resolveConnectionsMock.mockReset();
  getPrimaryMock.mockReset();
  harvestIdsMock.mockReset();
  listProvidersMock.mockReset();
  registryAllMock.mockReset();
  pickSingleMock.mockReset();
  registryAllMock.mockReturnValue([]);
  getPrimaryMock.mockResolvedValue(null);
  pickSingleMock.mockImplementation(async (_userId: string, pluginId: string) =>
    userConn(pluginId),
  );
  setCacheProviderForTest(new MemoryCache());
});

// ---------------------------------------------------------------------------
// fillGaps — exercised through dispatchPrimary with two-provider scenarios.
// ---------------------------------------------------------------------------

describe("fillGaps (via dispatchPrimary)", () => {
  it("fills a null field in primary from enrichment", async () => {
    listProvidersMock.mockReturnValue(["tmdb", "trakt"]);
    invokeMock
      .mockResolvedValueOnce({ title: "Matrix", overview: null, ids: {} })
      .mockResolvedValueOnce({ title: "Other", overview: "A classic", ids: {} });

    const result = await dispatchPrimary<{ title: string; overview: string | null }>(req());
    expect(result.data.overview).toBe("A classic");
  });

  it("fills an undefined field in primary from enrichment", async () => {
    listProvidersMock.mockReturnValue(["tmdb", "trakt"]);
    invokeMock
      .mockResolvedValueOnce({ title: "Matrix", ids: {} })
      .mockResolvedValueOnce({ title: "Other", overview: "Filled", ids: {} });

    const result = await dispatchPrimary<{ title: string; overview?: string }>(req());
    expect(result.data.overview).toBe("Filled");
  });

  it("fills an empty string in primary from enrichment", async () => {
    listProvidersMock.mockReturnValue(["tmdb", "trakt"]);
    invokeMock
      .mockResolvedValueOnce({ title: "Matrix", tagline: "", ids: {} })
      .mockResolvedValueOnce({ title: "Other", tagline: "Welcome to the real world.", ids: {} });

    const result = await dispatchPrimary<{ title: string; tagline: string }>(req());
    expect(result.data.tagline).toBe("Welcome to the real world.");
  });

  it("fills an empty array field from enrichment", async () => {
    listProvidersMock.mockReturnValue(["tmdb", "trakt"]);
    invokeMock
      .mockResolvedValueOnce({ title: "Matrix", genres: [], ids: {} })
      .mockResolvedValueOnce({ title: "Other", genres: ["sci-fi"], ids: {} });

    const result = await dispatchPrimary<{ title: string; genres: string[] }>(req());
    expect(result.data.genres).toEqual(["sci-fi"]);
  });

  it("does not overwrite a non-empty primary field with enrichment value", async () => {
    listProvidersMock.mockReturnValue(["tmdb", "trakt"]);
    invokeMock
      .mockResolvedValueOnce({ title: "Matrix", overview: "Primary overview", ids: {} })
      .mockResolvedValueOnce({ title: "Other", overview: "Enrichment overview", ids: {} });

    const result = await dispatchPrimary<{ title: string; overview: string }>(req());
    expect(result.data.overview).toBe("Primary overview");
  });

  it("does not overwrite a non-empty array with enrichment value", async () => {
    listProvidersMock.mockReturnValue(["tmdb", "trakt"]);
    invokeMock
      .mockResolvedValueOnce({ title: "Matrix", genres: ["action"], ids: {} })
      .mockResolvedValueOnce({ title: "Other", genres: ["sci-fi"], ids: {} });

    const result = await dispatchPrimary<{ title: string; genres: string[] }>(req());
    expect(result.data.genres).toEqual(["action"]);
  });

  it("deep-merges nested objects, filling missing sub-fields", async () => {
    listProvidersMock.mockReturnValue(["tmdb", "trakt"]);
    invokeMock
      .mockResolvedValueOnce({ ids: { tmdb: "603" } })
      .mockResolvedValueOnce({ ids: { imdb: "tt0133093", trakt: "1" } });

    const result = await dispatchPrimary<{ ids: Record<string, string> }>(req());
    expect(result.data.ids).toEqual({ tmdb: "603", imdb: "tt0133093", trakt: "1" });
  });

  it("does not overwrite existing nested fields during deep merge", async () => {
    listProvidersMock.mockReturnValue(["tmdb", "trakt"]);
    invokeMock
      .mockResolvedValueOnce({ ids: { tmdb: "603", imdb: "tt-primary" } })
      .mockResolvedValueOnce({ ids: { imdb: "tt-enrichment", trakt: "1" } });

    const result = await dispatchPrimary<{ ids: Record<string, string> }>(req());
    expect(result.data.ids.imdb).toBe("tt-primary");
    expect(result.data.ids.trakt).toBe("1");
  });
});

// ---------------------------------------------------------------------------
// mergeEnrichedResults — tested through dispatchPrimary.
// ---------------------------------------------------------------------------

describe("mergeEnrichedResults (via dispatchPrimary)", () => {
  it("returns primary data unchanged when only one provider succeeds", async () => {
    listProvidersMock.mockReturnValue(["tmdb"]);
    invokeMock.mockResolvedValueOnce({ title: "Solo", ids: { tmdb: "1" } });

    const result = await dispatchPrimary<{ title: string }>(req());
    expect(result.data.title).toBe("Solo");
  });

  it("returns primary data unchanged when enrichment returns null", async () => {
    listProvidersMock.mockReturnValue(["tmdb", "trakt"]);
    invokeMock
      .mockResolvedValueOnce({ title: "Matrix", ids: { tmdb: "603" } })
      .mockResolvedValueOnce(null);

    const result = await dispatchPrimary<{ title: string }>(req());
    expect(result.data.title).toBe("Matrix");
  });

  it("returns primary data unchanged when enrichment returns an array (non-object)", async () => {
    // When the primary result is an array, mergeEnrichedResults short-circuits
    // and returns it directly — no field-level merge is attempted.
    listProvidersMock.mockReturnValue(["tmdb", "trakt"]);
    invokeMock
      .mockResolvedValueOnce([{ id: "1" }, { id: "2" }])
      .mockResolvedValueOnce([{ id: "3" }]);

    const result = await dispatchPrimary<unknown[]>(req());
    expect(result.data).toEqual([{ id: "1" }, { id: "2" }]);
  });

  it("accumulates fields from three successful providers", async () => {
    listProvidersMock.mockReturnValue(["tmdb", "trakt", "tvdb"]);
    invokeMock
      .mockResolvedValueOnce({ ids: { tmdb: "603" } })
      .mockResolvedValueOnce({ ids: { trakt: "99" } })
      .mockResolvedValueOnce({ ids: { tvdb: "321" } });

    const result = await dispatchPrimary<{ ids: Record<string, string> }>(req());
    expect(result.data.ids).toEqual({ tmdb: "603", trakt: "99", tvdb: "321" });
  });
});

// ---------------------------------------------------------------------------
// Prototype pollution defense — issue #451.
// Plugin responses may carry an own `__proto__` key when the plugin forwards
// a `JSON.parse` result from an external API. Both safeClone (used to copy
// primary + enrichment data) and fillGaps (used to merge them) must filter
// `__proto__`, `constructor`, and `prototype` so attacker-controlled keys
// never reach the worker's `Object.prototype`.
// ---------------------------------------------------------------------------

describe("prototype pollution defense (issue #451)", () => {
  function maliciousPayload(key: "__proto__" | "constructor" | "prototype") {
    // JSON.parse is the only way to create a real own `__proto__` property; an
    // object literal `{ __proto__: ... }` sets the prototype instead.
    return JSON.parse(`{"title":"Hijack","${key}":{"polluted":true}}`);
  }

  it("does not pollute Object.prototype when enrichment carries an own __proto__ key", async () => {
    listProvidersMock.mockReturnValue(["tmdb", "trakt"]);
    invokeMock
      .mockResolvedValueOnce({ title: "Matrix", ids: {} })
      .mockResolvedValueOnce(maliciousPayload("__proto__"));

    await dispatchPrimary(req());

    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("does not pollute Object.prototype when the primary itself carries an own __proto__ key", async () => {
    listProvidersMock.mockReturnValue(["tmdb", "trakt"]);
    invokeMock
      .mockResolvedValueOnce(maliciousPayload("__proto__"))
      .mockResolvedValueOnce({ title: "Other", ids: {} });

    await dispatchPrimary(req());

    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("does not pollute Object.prototype via a `constructor` key in enrichment", async () => {
    listProvidersMock.mockReturnValue(["tmdb", "trakt"]);
    invokeMock
      .mockResolvedValueOnce({ title: "Matrix", ids: {} })
      .mockResolvedValueOnce(maliciousPayload("constructor"));

    await dispatchPrimary(req());

    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("does not pollute Object.prototype via a nested __proto__ key in enrichment", async () => {
    listProvidersMock.mockReturnValue(["tmdb", "trakt"]);
    invokeMock
      .mockResolvedValueOnce({ title: "Matrix", ids: { tmdb: "1" } })
      .mockResolvedValueOnce(JSON.parse(`{"ids":{"__proto__":{"nested":true}}}`));

    await dispatchPrimary(req());

    expect(({} as Record<string, unknown>).nested).toBeUndefined();
  });

  it("strips dangerous keys from the merged result instead of carrying them through", async () => {
    listProvidersMock.mockReturnValue(["tmdb", "trakt"]);
    invokeMock
      .mockResolvedValueOnce({ title: "Matrix", ids: {} })
      .mockResolvedValueOnce(maliciousPayload("__proto__"));

    const result = await dispatchPrimary<Record<string, unknown>>(req());

    // Dangerous keys are filtered, not preserved as own properties.
    expect(Object.hasOwn(result.data, "__proto__")).toBe(false);
    expect((result.data as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it("still merges legitimate fields when enrichment also contains a dangerous key", async () => {
    listProvidersMock.mockReturnValue(["tmdb", "trakt"]);
    invokeMock
      .mockResolvedValueOnce({ title: "Matrix", overview: null, ids: {} })
      .mockResolvedValueOnce(JSON.parse(`{"overview":"Filled","__proto__":{"polluted":true}}`));

    const result = await dispatchPrimary<{ overview: string }>(req());

    expect(result.data.overview).toBe("Filled");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// dispatchPrimary — ordering, error handling, caching, and no-provider guard.
// ---------------------------------------------------------------------------

describe("dispatchPrimary", () => {
  it("returns an empty result without calling providers when provider list is empty", async () => {
    listProvidersMock.mockReturnValue([]);

    const result = await dispatchPrimary(req());
    expect(result.data).toBeNull();
    expect(result.errors).toHaveLength(0);
    expect(result.attempted).toBe(0);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("places the user's stored primary first regardless of registry order", async () => {
    listProvidersMock.mockReturnValue(["tmdb", "trakt"]);
    getPrimaryMock.mockResolvedValue({ pluginId: "trakt", connectionId: "trakt-conn" });
    invokeMock
      .mockResolvedValueOnce({ title: "From Trakt", ids: {} })
      .mockResolvedValueOnce({ title: "From TMDB", ids: {} });

    const result = await dispatchPrimary<{ title: string }>(req());
    expect(result.data.title).toBe("From Trakt");
  });

  it("defaults to the registry's first provider when no primary is stored", async () => {
    listProvidersMock.mockReturnValue(["tmdb", "trakt"]);
    getPrimaryMock.mockResolvedValue(null);
    invokeMock
      .mockResolvedValueOnce({ title: "From TMDB", ids: {} })
      .mockResolvedValueOnce({ title: "From Trakt", ids: {} });

    const result = await dispatchPrimary<{ title: string }>(req());
    expect(result.data.title).toBe("From TMDB");
  });

  it("collects errors from failing providers alongside a successful primary", async () => {
    listProvidersMock.mockReturnValue(["tmdb", "trakt"]);
    // Two rejections: initial call + transient-backoff retry for trakt.
    invokeMock
      .mockResolvedValueOnce({ title: "OK", ids: {} })
      .mockRejectedValueOnce(new PluginError("plugin.upstream_error", "trakt down"))
      .mockRejectedValueOnce(new PluginError("plugin.upstream_error", "trakt still down"));

    vi.useFakeTimers();
    const promise = dispatchPrimary(req());
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await promise;
    vi.useRealTimers();

    expect(result.data).not.toBeNull();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.code).toBe("plugin.upstream_error");
  });

  it("does not surface plugin.item_not_found as an error", async () => {
    listProvidersMock.mockReturnValue(["tmdb", "trakt"]);
    invokeMock
      .mockResolvedValueOnce({ title: "OK", ids: {} })
      .mockRejectedValueOnce(new PluginError("plugin.item_not_found", "no item"));

    const result = await dispatchPrimary(req());
    expect(result.errors).toHaveLength(0);
  });

  it("returns data:null when every provider fails", async () => {
    listProvidersMock.mockReturnValue(["tmdb"]);
    // Two rejections: initial call + transient-backoff retry.
    invokeMock
      .mockRejectedValueOnce(new PluginError("plugin.upstream_error", "down"))
      .mockRejectedValueOnce(new PluginError("plugin.upstream_error", "still down"));

    vi.useFakeTimers();
    const promise = dispatchPrimary(req());
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await promise;
    vi.useRealTimers();

    expect(result.data).toBeNull();
    expect(result.errors).toHaveLength(1);
    expect(result.attempted).toBe(1);
  });

  it("negative-caches at NEGATIVE_TTL_MS when every provider fails (all-fail)", async () => {
    listProvidersMock.mockReturnValue(["tmdb"]);
    // Two rejections: initial call + transient-backoff retry.
    invokeMock
      .mockRejectedValueOnce(new PluginError("plugin.upstream_error", "down"))
      .mockRejectedValueOnce(new PluginError("plugin.upstream_error", "still down"));

    const cache = new MemoryCache();
    const setSpy = vi.spyOn(cache, "set");
    setCacheProviderForTest(cache);

    vi.useFakeTimers();
    const promise = dispatchPrimary(req());
    await vi.advanceTimersByTimeAsync(2_000);
    await promise;
    vi.useRealTimers();

    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy.mock.calls[0]![2]).toBe(60 * 1000);
  });

  it("uses capability TTL (not negative) when providers succeed but return null data", async () => {
    listProvidersMock.mockReturnValue(["tmdb"]);
    invokeMock.mockResolvedValueOnce(null);

    const cache = new MemoryCache();
    const setSpy = vi.spyOn(cache, "set");
    setCacheProviderForTest(cache);

    await dispatchPrimary(req());

    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy.mock.calls[0]![2]).not.toBe(60 * 1000);
  });

  it("serves subsequent calls from cache without re-invoking providers", async () => {
    listProvidersMock.mockReturnValue(["tmdb"]);
    invokeMock.mockResolvedValue({ title: "Cached", ids: {} });

    const base = req();
    await dispatchPrimary(base);
    await dispatchPrimary(base);

    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("skips providers that have no active connection", async () => {
    listProvidersMock.mockReturnValue(["tmdb", "trakt"]);
    // trakt has no connection.
    pickSingleMock.mockImplementation(async (_userId: string, pluginId: string) =>
      pluginId === "tmdb" ? userConn("tmdb") : null,
    );
    invokeMock.mockResolvedValueOnce({ title: "TMDB only", ids: {} });

    const result = await dispatchPrimary<{ title: string }>(req());
    expect(result.data.title).toBe("TMDB only");
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("returns attempted count equal to candidate count", async () => {
    listProvidersMock.mockReturnValue(["tmdb", "trakt"]);
    invokeMock
      .mockResolvedValueOnce({ title: "A", ids: {} })
      .mockResolvedValueOnce({ title: "B", ids: {} });

    const result = await dispatchPrimary(req());
    expect(result.attempted).toBe(2);
  });
});
