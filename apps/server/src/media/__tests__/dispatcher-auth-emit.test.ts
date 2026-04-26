import { describe, it, expect, beforeEach, vi } from "vite-plus/test";
import { PluginError } from "@ent-mcp/plugin-sdk";
import type { emit as emitFn } from "../../notifications/emit";

type EmitArg = Parameters<typeof emitFn>[0];

vi.mock("../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

const { MemoryCache } = await import("../../cache/memory");
const { setCacheProviderForTest } = await import("../cache");

const invokeMock = vi.fn();
const refreshAuthMock = vi.fn();
const resolveConnectionsMock = vi.fn();
const listProvidersMock = vi.fn();
const registryAllMock = vi.fn();
const emitMock = vi.fn<(event: EmitArg) => Promise<void>>(async () => undefined);

vi.mock("../../plugin-runtime/runtime", () => ({
  pluginRuntime: {
    invoke: (...args: unknown[]) => invokeMock(...args),
    invokeWithCredentials: (...args: unknown[]) => invokeMock(...args),
    refreshAuth: (...args: unknown[]) => refreshAuthMock(...args),
  },
}));

vi.mock("../resolve-connection", () => ({
  resolveConnections: (...args: unknown[]) => resolveConnectionsMock(...args),
}));

vi.mock("../primary-preference", () => ({
  getPrimaryConnection: async () => null,
  setPrimaryConnection: vi.fn(),
  clearPrimaryConnection: vi.fn(),
}));

vi.mock("../id-resolver", () => ({
  harvestIds: async () => undefined,
}));

vi.mock("../../plugin-runtime/registry", () => ({
  capabilityRegistry: {
    listProviders: (...args: unknown[]) => listProvidersMock(...args),
    all: () => registryAllMock(),
  },
}));

vi.mock("../../db/client", () => ({
  getDb: () => ({
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  }),
}));

vi.mock("../../crypto/vault", () => ({
  encrypt: async (plain: string) => `iv:${plain}`,
}));

vi.mock("../../crypto/hash", () => ({
  sha256: async (s: string) => s.slice(0, 32).padEnd(32, "0"),
}));

vi.mock("../../notifications/emit", () => ({
  emit: emitMock,
}));

const { dispatchSingle } = await import("../dispatcher");

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

beforeEach(() => {
  invokeMock.mockReset();
  refreshAuthMock.mockReset();
  resolveConnectionsMock.mockReset();
  listProvidersMock.mockReset();
  registryAllMock.mockReset();
  registryAllMock.mockReturnValue([]);
  emitMock.mockClear();
  setCacheProviderForTest(new MemoryCache());
});

describe("dispatcher auth-expired emit", () => {
  it("emits connection.auth.expired when refresh fails", async () => {
    listProvidersMock.mockReturnValue(["seerr"]);
    resolveConnectionsMock.mockResolvedValue([userConn("seerr", "conn-99")]);
    invokeMock.mockRejectedValueOnce(new PluginError("plugin.token_expired", "stale"));
    refreshAuthMock.mockRejectedValueOnce(new Error("upstream 401"));

    await expect(
      dispatchSingle({
        userId: "user-1",
        capability: "mediaRequest",
        version: "v1",
        method: "listRequests",
        input: {},
      }),
    ).rejects.toThrow();

    expect(emitMock).toHaveBeenCalledTimes(1);
    const call = emitMock.mock.calls[0];
    if (!call) throw new Error("expected emit call");
    expect(call[0]).toMatchObject({
      type: "connection.auth.expired",
      category: "auth",
      severity: "warn",
      audience: { kind: "user", userId: "user-1" },
      payload: { connectionId: "conn-99", pluginId: "seerr" },
    });
  });

  it("does not emit when refresh succeeds", async () => {
    listProvidersMock.mockReturnValue(["seerr"]);
    resolveConnectionsMock.mockResolvedValue([userConn("seerr")]);
    invokeMock
      .mockRejectedValueOnce(new PluginError("plugin.token_expired", "stale"))
      .mockResolvedValueOnce([{ id: "r1" }]);
    refreshAuthMock.mockResolvedValueOnce({ token: "fresh" });

    await dispatchSingle({
      userId: "user-1",
      capability: "mediaRequest",
      version: "v1",
      method: "listRequests",
      input: {},
    });

    expect(emitMock).not.toHaveBeenCalled();
  });

  it("emit failure does not propagate to host operation", async () => {
    listProvidersMock.mockReturnValue(["seerr"]);
    resolveConnectionsMock.mockResolvedValue([userConn("seerr")]);
    invokeMock.mockRejectedValueOnce(new PluginError("plugin.token_expired", "stale"));
    refreshAuthMock.mockRejectedValueOnce(new Error("upstream 401"));
    emitMock.mockRejectedValueOnce(new Error("emit boom"));

    await expect(
      dispatchSingle({
        userId: "user-1",
        capability: "mediaRequest",
        version: "v1",
        method: "listRequests",
        input: {},
      }),
    ).rejects.toThrow();
  });
});
